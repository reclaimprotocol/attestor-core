import {
	CONFIG as ZK_CONFIG,
	EncryptionAlgorithm,
	generateProof,
	makeLocalSnarkJsZkOperator,
	makeRemoteSnarkJsZkOperator,
	verifyProof,
	ZKOperator,
} from '@reclaimprotocol/circom-symmetric-crypto'
import { detectEnvironment } from '@reclaimprotocol/common-grpc-web-transport'
import { CipherSuite, crypto } from '@reclaimprotocol/tls'
import PQueue from 'p-queue'
import { DEFAULT_REMOTE_ZK_PARAMS, DEFAULT_ZK_CONCURRENCY, MAX_ZK_CHUNKS } from '../config'
import { FinaliseSessionRequest_BlockRevealZk as ZKReveal, FinaliseSessionRequest_ZKProof as ZKProof } from '../proto/api'
import { CompleteTLSPacket, Logger } from '../types'
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

export type PrepareZKProofsBaseOpts = {
	/** get ZK operator for specified algorithm */
	zkOperators?: { [E in EncryptionAlgorithm]?: ZKOperator }
	/**
	 * max number of ZK proofs to generate concurrently
	 * @default 1
	 */
	zkProofConcurrency?: number
	maxZkChunks?: number
}

type PrepareZKProofsOpts = {
	logger?: Logger
} & PrepareZKProofsBaseOpts

type ZKVerifyOpts = {
	cipherSuite: CipherSuite
	ciphertext: Uint8Array
	zkReveal: ZKReveal
	logger?: Logger
	/** get ZK operator for specified algorithm */
	zkOperators?: { [E in EncryptionAlgorithm]?: ZKOperator }
}

export function makeZkProofGenerator(
	{
		zkOperators,
		logger,
		zkProofConcurrency = DEFAULT_ZK_CONCURRENCY,
		maxZkChunks = MAX_ZK_CHUNKS,
	}: PrepareZKProofsOpts
) {
	const zkQueue = new PQueue({
		concurrency: zkProofConcurrency,
		autoStart: true,
	})

	logger = logger || LOGGER.child({ module: 'zk' })
	let chunksDone = 0

	return {
		async generateProof(
			packet: CompleteTLSPacket,
			cipherSuite: CipherSuite
		): Promise<ZKReveal> {
			if(packet.reveal?.type !== 'zk') {
				throw new Error('only partial reveals are supported')
			}

			if(packet.ctx.type === 'plaintext') {
				throw new Error('Cannot generate proof for plaintext')
			}

			if(chunksDone > maxZkChunks) {
				throw new Error(
					`Too many chunks to prove: ${chunksDone} > ${maxZkChunks}`
				)
			}

			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const chunkSizeBytes = getChunkSizeBytes(alg)

			const {
				redactedPlaintext,
			} = packet.reveal
			const key = await crypto.exportKey(packet.ctx.encKey)
			const iv = packet.ctx.iv
			const ciphertext = getPureCiphertext(
				packet.ctx.ciphertext,
				cipherSuite
			)

			const chunks = Math.ceil(ciphertext.length / chunkSizeBytes)
			const tasks: Promise<void>[] = []
			const proofs: ZKProof[] = []
			for(let i = 0;i < chunks;i++) {
				tasks.push(
					zkQueue.add(async() => {
						const proof = await generateProofForChunk(
							alg,
							{
								key,
								iv,
								ciphertext,
								redactedPlaintext,
								offsetChunks: i
							},
						)
						if(proof) {
							proofs.push(proof)
						}
					}, { throwOnTimeout: true })
				)

				chunksDone += 1
			}

			await Promise.all(tasks)

			return { proofs }
		}
	}

	async function generateProofForChunk(
		algorithm: EncryptionAlgorithm,
		{
			key,
			iv,
			ciphertext,
			redactedPlaintext,
			offsetChunks,
		}: GenerateZKChunkProofOpts,
	): Promise<ZKProof | undefined> {
		const zkOperator = zkOperators?.[algorithm]
			|| await makeDefaultZkOperator(algorithm, logger)
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

		const proof = await generateProof(
			algorithm,
			{ key, iv, offset: offsetChunks },
			{ ciphertext: ciphertextChunk },
			zkOperator,
		)

		logger?.debug(
			{ startIdx, endIdx },
			'generated proof for chunk'
		)

		return {
			proofJson: proof.proofJson,
			decryptedRedactedCiphertext: proof.plaintext,
			redactedPlaintext: plaintextChunk,
			startIdx,
		}
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
		logger?.debug(
			{ type: isNode ? 'local' : 'remote' },
			'using zk operator'
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
	}

	return zkOperators[algorithm]!
}