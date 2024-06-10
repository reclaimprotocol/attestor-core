import {
	CONFIG as ZK_CONFIG,
	EncryptionAlgorithm,
	generateProof,
	makeLocalSnarkJsZkOperator,
	makeSnarkJsZKOperator,
	PrivateInput,
	PublicInput,
	verifyProof,
	ZKOperator,
} from '@reclaimprotocol/circom-symmetric-crypto'
import { CipherSuite, crypto } from '@reclaimprotocol/tls'
import { DEFAULT_REMOTE_ZK_PARAMS, DEFAULT_ZK_CONCURRENCY, MAX_ZK_CHUNKS } from '../config'
import { MessageReveal_MessageRevealZk as ZKReveal, MessageReveal_ZKProof as ZKProof } from '../proto/api'
import { CompleteTLSPacket, Logger, PrepareZKProofsBaseOpts, ZKOperators, ZKRevealInfo } from '../types'
import { detectEnvironment, getEnvVariable } from './env'
import { WitnessError } from './error'
import { getPureCiphertext, getZkAlgorithmForCipherSuite } from './generics'
import { logger as LOGGER } from './logger'
import { isFullyRedacted, isRedactionCongruent, REDACTION_CHAR_CODE } from './redactions'
import { executeWithRetries } from './retries'

type GenerateZKChunkProofOpts = {
	key: Uint8Array
	iv: Uint8Array
	/**
	 * ciphertext obtained from the TLS packet
	 * includes authTag, record IV, and ciphertext
	 */
	ciphertext: Uint8Array
	redactedPlaintext: Uint8Array
	offsetChunks: number
}

type PrepareZKProofsOpts = {
	logger?: Logger
	cipherSuite: CipherSuite
} & PrepareZKProofsBaseOpts

type ZKVerifyOpts = {
	cipherSuite: CipherSuite
	ciphertext: Uint8Array
	zkReveal: ZKReveal
	logger?: Logger
	/** get ZK operator for specified algorithm */
	zkOperators?: ZKOperators
}

type ZKProofToGenerate = {
	startIdx: number
	redactedPlaintext: Uint8Array
	privateInput: PrivateInput
	publicInput: PublicInput
}

type ZKPacketToProve = {
	onGeneratedProofs(proofs: ZKProof[]): void
	algorithm: EncryptionAlgorithm
	proofsToGenerate: ZKProofToGenerate[]
}

const ZK_CONCURRENCY = +(
	getEnvVariable('ZK_CONCURRENCY')
	|| DEFAULT_ZK_CONCURRENCY
)

export async function makeZkProofGenerator(
	{
		zkOperators,
		logger = LOGGER,
		zkProofConcurrency = ZK_CONCURRENCY,
		maxZkChunks = MAX_ZK_CHUNKS,
		cipherSuite,
	}: PrepareZKProofsOpts
) {

	const { default: PQueue } = await import('p-queue')
	const zkQueue = new PQueue({
		concurrency: zkProofConcurrency,
		autoStart: true,
	})

	const packetsToProve: ZKPacketToProve[] = []

	logger = (logger || LOGGER).child({ module: 'zk' })
	let zkChunksToProve = 0

	return {
		/**
		 * Adds the given packet to the list of packets to
		 * generate ZK proofs for.
		 *
		 * Call `generateProofs()` to finally generate the proofs
		 */
		async addPacketToProve(
			packet: CompleteTLSPacket,
			reveal: ZKRevealInfo,
			onGeneratedProofs: ZKPacketToProve['onGeneratedProofs']
		) {
			if(packet.type === 'plaintext') {
				throw new Error('Cannot generate proof for plaintext')
			}

			if(zkChunksToProve > maxZkChunks) {
				throw new Error(
					`Too many chunks to prove: ${zkChunksToProve} > ${maxZkChunks}`
				)
			}

			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const chunkSizeBytes = getChunkSizeBytes(alg)

			const { redactedPlaintext } = reveal
			const key = await crypto.exportKey(packet.encKey)
			const iv = packet.iv
			const ciphertext = getPureCiphertext(
				packet.ciphertext,
				cipherSuite
			)
			const chunks = Math.ceil(ciphertext.length / chunkSizeBytes)
			const packetToProve: ZKPacketToProve = {
				onGeneratedProofs,
				algorithm: alg,
				proofsToGenerate: [],
			}

			for(let i = 0;i < chunks;i++) {
				const proof = getProofGenerationParamsForChunk(
					alg,
					{
						key,
						iv,
						ciphertext,
						redactedPlaintext,
						offsetChunks: i
					},
				)
				if(!proof) {
					continue
				}

				packetToProve.proofsToGenerate.push(proof)
				zkChunksToProve += 1
			}

			packetsToProve.push(packetToProve)
		},
		getTotalChunksToProve() {
			return zkChunksToProve
		},
		async generateProofs(onChunkDone?: () => void) {
			const start = Date.now()
			const tasks: Promise<void>[] = []
			for(const { onGeneratedProofs, algorithm, proofsToGenerate } of packetsToProve) {
				const proofs: ZKProof[] = []

				let proofsLeft = proofsToGenerate.length
				for(const proofToGen of proofsToGenerate) {
					tasks.push(
						zkQueue.add(async() => {
							const proof = await generateProofForChunk(
								algorithm,
								proofToGen,
							)

							onChunkDone?.()
							proofs.push(proof)

							proofsLeft -= 1
							if(proofsLeft === 0) {
								onGeneratedProofs(proofs)
							}
						}, { throwOnTimeout: true })
					)
				}
			}

			await Promise.all(tasks)

			logger?.info(
				{
					durationMs: Date.now() - start,
					chunks: zkChunksToProve,
				},
				'generated ZK proofs'
			)

			// reset the packets to prove
			packetsToProve.splice(0, packetsToProve.length)
			zkChunksToProve = 0

			// release ZK resources to free up memory
			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const zkOperator = await getZkOperatorForAlgorithm(alg)
			zkOperator.release?.()
		},
	}

	function getProofGenerationParamsForChunk(
		algorithm: EncryptionAlgorithm,
		{
			key,
			iv,
			ciphertext,
			redactedPlaintext,
			offsetChunks,
		}: GenerateZKChunkProofOpts,
	): ZKProofToGenerate | undefined {
		const chunkSize = getChunkSizeBytes(algorithm)

		const startIdx = offsetChunks * chunkSize
		const endIdx = (offsetChunks + 1) * chunkSize
		const ciphertextChunk = ciphertext
			.slice(startIdx, endIdx)
		const plaintextChunk = redactedPlaintext
			.slice(startIdx, endIdx)
		if(isFullyRedacted(plaintextChunk)) {
			return
		}

		// redact ciphertext if plaintext is redacted
		// to prepare for decryption in ZK circuit
		// the ZK circuit will take in the redacted ciphertext,
		// which shall produce the redacted plaintext
		for(let i = 0;i < ciphertextChunk.length;i++) {
			if(plaintextChunk[i] === REDACTION_CHAR_CODE) {
				ciphertextChunk[i] = REDACTION_CHAR_CODE
			}
		}

		return {
			startIdx,
			redactedPlaintext: plaintextChunk,
			privateInput: { key, iv, offset: offsetChunks },
			publicInput: { ciphertext: ciphertextChunk },
		}
	}

	async function generateProofForChunk(
		algorithm: EncryptionAlgorithm,
		{
			startIdx, redactedPlaintext,
			privateInput, publicInput
		}: ZKProofToGenerate
	): Promise<ZKProof> {
		const operator = await getZkOperatorForAlgorithm(algorithm)
		const proof = await generateProof(
			{
				algorithm,
				privateInput,
				publicInput,
				operator,
				logger
			}
		)

		logger?.debug({ startIdx }, 'generated proof for chunk')

		return {
			proofJson: proof.proofJson,
			decryptedRedactedCiphertext: proof.plaintext,
			redactedPlaintext,
			startIdx,
		}
	}

	async function getZkOperatorForAlgorithm(algorithm: EncryptionAlgorithm) {
		return zkOperators?.[algorithm]
			|| await makeDefaultZkOperator(algorithm, logger)
	}
}

/**
 * Verify the given ZK proof
 */
export async function verifyZkPacket(
	{
		cipherSuite,
		ciphertext,
		zkReveal,
		zkOperators,
		logger = LOGGER
	}: ZKVerifyOpts,
) {
	if(!zkReveal) {
		throw new Error('No ZK reveal')
	}

	const { proofs } = zkReveal
	const algorithm = getZkAlgorithmForCipherSuite(cipherSuite)
	const operator = zkOperators?.[algorithm]
		|| await makeDefaultZkOperator(algorithm, logger)

	ciphertext = getPureCiphertext(ciphertext, cipherSuite)
	/**
	 * to verify if the user has given us the correct redacted plaintext,
	 * and isn't providing plaintext that they haven't proven they have
	 * we start with a fully redacted plaintext, and then replace the
	 * redacted parts with the plaintext that the user has provided
	 * in the proofs
	 */
	const realRedactedPlaintext = new Uint8Array(
		ciphertext.length,
	).fill(REDACTION_CHAR_CODE)

	await Promise.all(
		proofs.map(async({
			proofJson,
			decryptedRedactedCiphertext,
			redactedPlaintext,
			startIdx,
		}, i) => {
			// get the ciphertext chunk we received from the server
			// the ZK library, will verify that the decrypted redacted
			// ciphertext matches the ciphertext received from the server
			const ciphertextChunk = ciphertext.slice(
				startIdx,
				startIdx + redactedPlaintext.length
			)

			// redact ciphertext if plaintext is redacted
			// to prepare for decryption in ZK circuit
			// the ZK circuit will take in the redacted ciphertext,
			// which shall produce the redacted plaintext
			for(let i = 0;i < ciphertextChunk.length;i++) {
				if(redactedPlaintext[i] === REDACTION_CHAR_CODE) {
					ciphertextChunk[i] = REDACTION_CHAR_CODE
				}
			}

			if(!isRedactionCongruent(
				redactedPlaintext,
				decryptedRedactedCiphertext
			)) {
				throw new Error(`redacted ciphertext (${i}) not congruent`)
			}

			await verifyProof(
				{
					proof: {
						algorithm,
						proofJson,
						plaintext: decryptedRedactedCiphertext,
					},
					publicInput: { ciphertext: ciphertextChunk },
					operator,
					logger,
				}
			)

			logger?.debug(
				{ startIdx, endIdx: startIdx + redactedPlaintext.length },
				'verified proof'
			)

			realRedactedPlaintext.set(
				redactedPlaintext,
				startIdx,
			)
		})
	)

	return { redactedPlaintext: realRedactedPlaintext }
}

function getChunkSizeBytes(alg: EncryptionAlgorithm) {
	const {
		chunkSize,
		bitsPerWord
	} = ZK_CONFIG[alg]

	return chunkSize * bitsPerWord / 8
}

const zkOperators: { [E in EncryptionAlgorithm]?: Promise<ZKOperator> } = {}
export function makeDefaultZkOperator(
	algorithm: EncryptionAlgorithm,
	logger: Logger
) {
	if(!zkOperators[algorithm]) {
		const isNode = detectEnvironment() === 'node'
		const opType = isNode ? 'local' : 'remote'
		logger?.info(
			{
				type: opType,
				algorithm
			},
			'fetching zk operator'
		)

		if(isNode) {
			zkOperators[algorithm]
				= makeLocalSnarkJsZkOperator(algorithm)
		} else {
			const { zkeyUrl, circuitWasmUrl } = DEFAULT_REMOTE_ZK_PARAMS
			const operator = makeRemoteSnarkJsZkOperator(
				zkeyUrl.replace('{algorithm}', algorithm),
				circuitWasmUrl.replace('{algorithm}', algorithm),
				logger
			)
			zkOperators[algorithm] = Promise.resolve(operator)
		}

		logger?.info(
			{
				type: isNode ? 'local' : 'remote',
				algorithm
			},
			'got zk operator'
		)
	}

	return zkOperators[algorithm]!
}

function makeRemoteSnarkJsZkOperator(
	zkeyUrl: string,
	wasmUrl: string,
	logger: Logger
) {
	return makeSnarkJsZKOperator(
		{
			getCircuitWasm: () => fetchArrayBuffer('wasm', wasmUrl),
			getZkey: () => (
				fetchArrayBuffer('zkey', zkeyUrl)
					.then(data => ({ data }))
			),
		}
	)

	async function fetchArrayBuffer(type: string, url: string) {
		const res = await executeWithRetries(
			async() => {
				const res = await fetch(url)
				if(!res.ok) {
					throw new WitnessError(
						'WITNESS_ERROR_NETWORK_ERROR',
						`${type} fetch failed with code: ${res.status}`,
						{ url, status: res.status }
					)
				}

				const buff = await res.arrayBuffer()
				return buff
			},
			{
				logger: logger.child({ type }),
				maxRetries: 3,
				shouldRetry(error) {
					// network errors are TypeErrors
					// in fetch
					// https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API#concepts_and_usage
					return error instanceof TypeError
				},
			}
		)

		return new Uint8Array(res)
	}
}