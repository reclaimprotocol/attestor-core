import {
	CONFIG as ZK_CONFIG,
	EncryptionAlgorithm,
	generateProof,
	makeLocalSnarkJsZkOperator,
	makeRemoteSnarkJsZkOperator,
	PrivateInput,
	PublicInput,
	verifyProof,
	ZKOperator,
} from '@reclaimprotocol/circom-symmetric-crypto'
import { CipherSuite, crypto } from '@reclaimprotocol/tls'
import PQueue from 'p-queue'
import { DEFAULT_REMOTE_ZK_PARAMS, DEFAULT_ZK_CONCURRENCY, MAX_ZK_CHUNKS } from '../config'
import { FinaliseSessionRequest_Block as PacketToReveal, FinaliseSessionRequest_BlockRevealZk as ZKReveal, FinaliseSessionRequest_ZKProof as ZKProof } from '../proto/api'
import { CompleteTLSPacket, Logger } from '../types'
import { detectEnvironment } from './env'
import { getPureCiphertext, getZkAlgorithmForCipherSuite } from './generics'
import { logger as LOGGER } from './logger'
import { isFullyRedacted, isRedactionCongruent, REDACTION_CHAR_CODE } from './redactions'

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

export type ZKOperators = { [E in EncryptionAlgorithm]?: ZKOperator }

export type PrepareZKProofsBaseOpts = {
	/** get ZK operator for specified algorithm */
	zkOperators?: ZKOperators
	/**
	 * max number of ZK proofs to generate concurrently
	 * @default 1
	 */
	zkProofConcurrency?: number
	maxZkChunks?: number
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
	packet: CompleteTLSPacket
	algorithm: EncryptionAlgorithm
	proofsToGenerate: ZKProofToGenerate[]
}

export function makeZkProofGenerator(
	{
		zkOperators,
		logger,
		zkProofConcurrency = DEFAULT_ZK_CONCURRENCY,
		maxZkChunks = MAX_ZK_CHUNKS,
		cipherSuite,
	}: PrepareZKProofsOpts
) {
	const zkQueue = new PQueue({
		concurrency: zkProofConcurrency,
		autoStart: true,
	})
	const packetsToProve: ZKPacketToProve[] = []

	logger = logger || LOGGER.child({ module: 'zk' })
	let zkChunksToProve = 0

	return {
		/**
		 * Adds the given packet to the list of packets to
		 * generate ZK proofs for.
		 */
		async addPacketToProve(packet: CompleteTLSPacket) {
			if(packet.reveal?.type !== 'zk') {
				throw new Error('only partial reveals are supported')
			}

			if(packet.ctx.type === 'plaintext') {
				throw new Error('Cannot generate proof for plaintext')
			}

			if(zkChunksToProve > maxZkChunks) {
				throw new Error(
					`Too many chunks to prove: ${zkChunksToProve} > ${maxZkChunks}`
				)
			}

			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const chunkSizeBytes = getChunkSizeBytes(alg)

			const { redactedPlaintext } = packet.reveal
			const key = await crypto.exportKey(packet.ctx.encKey)
			const iv = packet.ctx.iv
			const ciphertext = getPureCiphertext(
				packet.ctx.ciphertext,
				cipherSuite
			)

			const chunks = Math.ceil(ciphertext.length / chunkSizeBytes)
			const packetToProve: ZKPacketToProve = {
				packet,
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
			const packetsToReveal: PacketToReveal[] = []
			const tasks: Promise<void>[] = []
			for(const { packet, algorithm, proofsToGenerate } of packetsToProve) {
				const packetToReveal: PacketToReveal = {
					index: packet.index,
					directReveal: undefined,
					zkReveal: { proofs: [] },
					authTag: new Uint8Array(0)
				}
				for(const proofToGen of proofsToGenerate) {
					tasks.push(
						zkQueue.add(async() => {
							const proof = await generateProofForChunk(
								algorithm,
								proofToGen,
							)

							onChunkDone?.()
							packetToReveal.zkReveal!.proofs.push(proof)
						}, { throwOnTimeout: true })
					)
				}

				packetsToReveal.push(packetToReveal)
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

			return packetsToReveal
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
		const zkOperator = await getZkOperatorForAlgorithm(algorithm)

		const proof = await generateProof(
			algorithm,
			privateInput,
			publicInput,
			zkOperator,
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
		logger
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
					algorithm,
					proofJson,
					plaintext: decryptedRedactedCiphertext,
				},
				{ ciphertext: ciphertextChunk },
				operator
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
	logger?: Logger
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
			zkOperators[algorithm] = makeLocalSnarkJsZkOperator(
				algorithm,
				logger
			)
		} else {
			const { zkeyUrl, circuitWasmUrl } = DEFAULT_REMOTE_ZK_PARAMS
			zkOperators[algorithm] = makeRemoteSnarkJsZkOperator(
				{
					zkeyUrl: zkeyUrl
						.replace('{algorithm}', algorithm),
					circuitWasmUrl: circuitWasmUrl
						.replace('{algorithm}', algorithm),
				},
				logger
			)
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