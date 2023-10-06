import {
	generateProof,
	makeLocalSnarkJsZkOperator,
	makeRemoteSnarkJsZkOperator,
	toUint8Array,
	toUintArray,
	verifyProof,
	ZKOperator
} from '@reclaimprotocol/circom-chacha20'
import { detectEnvironment } from '@reclaimprotocol/common-grpc-web-transport'
import { crypto, SUPPORTED_CIPHER_SUITE_MAP } from '@reclaimprotocol/tls'
import PQueue from 'p-queue'
import { DEFAULT_REMOTE_ZK_PARAMS, DEFAULT_ZK_CONCURRENCY, MAX_ZK_CHUNKS } from '../config'
import { FinaliseSessionRequest_BlockRevealZk as ZKReveal } from '../proto/api'
import { CompleteTLSPacket, Logger } from '../types'
import { getPureCiphertext } from './generics'
import { logger as LOGGER } from './logger'
import { isFullyRedacted, isRedactionCongruent, REDACTION_CHAR_CODE } from './redactions'

const CHACHA_CHUNK_SIZE = 64

type ZKChunk = {
	chunk: Uint8Array
	counter: number
}

type GenerateZKChunkProofOpts = {
	key: Uint8Array
	iv: Uint8Array
	ciphertext: Uint8Array
}

export type PrepareZKProofsBaseOpts = {
	/** params for ZK proof gen */
	zkOperator?: ZKOperator
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
	ciphertext: Uint8Array
	zkReveal: ZKReveal
	operator: ZKOperator
	logger?: Logger
}

export function makeZkProofGenerator(
	{
		zkOperator,
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
			cipherSuite: keyof typeof SUPPORTED_CIPHER_SUITE_MAP
		): Promise<ZKReveal> {
			if(packet.reveal?.type !== 'partial') {
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

			const {
				redactedPlaintext,
			} = packet.reveal
			const key = await crypto.exportKey(packet.ctx.encKey)
			const iv = packet.ctx.iv
			const ciphertext = getPureCiphertext(
				packet.ctx.ciphertext,
				cipherSuite
			)

			const zkChunks = getChunksWithIvCounter(redactedPlaintext)
			chunksDone += zkChunks.length

			return {
				proofs: await Promise.all(zkChunks.map(chunk => {
					return zkQueue.add(
						() => generateProofForChunk(
							{
								key,
								iv,
								ciphertext,
							},
							chunk
						),
						{ throwOnTimeout: true }
					)
				}))
			}
		}
	}

	async function generateProofForChunk(
		{
			key,
			iv,
			ciphertext,
		}: GenerateZKChunkProofOpts,
		{ chunk, counter }: ZKChunk,
	) {
		zkOperator = zkOperator || await makeDefaultZkOperator(logger)

		const startIdx = (counter - 1) * CHACHA_CHUNK_SIZE
		const endIdx = counter * CHACHA_CHUNK_SIZE
		const ciphertextChunk = ciphertext
			.slice(startIdx, endIdx)

		// redact ciphertext if plaintext is redacted
		// to prepare for decryption in ZK circuit
		// the ZK circuit will take in the redacted ciphertext,
		// which shall produce the redacted plaintext
		for(let i = 0;i < ciphertextChunk.length;i++) {
			if(chunk[i] === REDACTION_CHAR_CODE) {
				ciphertextChunk[i] = REDACTION_CHAR_CODE
			}
		}

		const proof = await generateProof(
			{ key, iv, startCounter: counter },
			{ ciphertext: ciphertextChunk },
			zkOperator,
		)

		logger?.debug(
			{ startIdx, endIdx },
			'generated proof for chunk'
		)

		return {
			proofJson: proof.proofJson,
			decryptedRedactedCiphertext: toUint8Array(
				proof.plaintext
			),
			redactedPlaintext: chunk,
			startIdx,
		}
	}
}

/**
 * Verify the given ZK proof
 */
export async function verifyZkPacket(
	{
		ciphertext,
		zkReveal,
		operator,
		logger
	}: ZKVerifyOpts,
) {
	if(!zkReveal) {
		throw new Error('No ZK reveal')
	}

	const { proofs } = zkReveal
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

			// logger?.info(
			// 	{
			// 		rp: uint8ArrayToBinaryStr(redactedPlaintext),
			// 		drc: uint8ArrayToBinaryStr(decryptedRedactedCiphertext),
			// 	}
			// )

			if(!isRedactionCongruent(
				redactedPlaintext,
				decryptedRedactedCiphertext
			)) {
				throw new Error(`redacted ciphertext (${i}) not congruent`)
			}

			await verifyProof(
				{
					proofJson,
					plaintext:
						toUintArray(decryptedRedactedCiphertext),
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

/**
 * Split the redacted plaintext into chacha-sized chunks,
 * and set a counter for each chunk.
 *
 * It will only return chunks that are fully or partially revealed
 * @param redactedPlaintext the redacted plaintext that need be split
 * @param blockSize the size of blocks to split data into
 */
function getChunksWithIvCounter(
	redactedPlaintext: Uint8Array,
	blockSize = CHACHA_CHUNK_SIZE
) {
	const chunks = chunkBuffer(redactedPlaintext, blockSize)
	const chunksWithCounter: ZKChunk[] = []
	for(let i = 0;i < chunks.length;i++) {
		if(!isFullyRedacted(chunks[i])) {
			chunksWithCounter.push({
				chunk: chunks[i],
				counter: i + 1,
			})
		}
	}

	return chunksWithCounter
}

function chunkBuffer(buffer: Uint8Array, chunkSize: number) {
	const chunks: Uint8Array[] = []
	for(let i = 0;i < buffer.length;i += chunkSize) {
		chunks.push(buffer.slice(i, i + chunkSize))
	}

	return chunks
}

let zkOperator: Promise<ZKOperator> | undefined
export function makeDefaultZkOperator(logger?: Logger) {
	if(!zkOperator) {
		const isNode = detectEnvironment() === 'node'
		logger?.debug(
			{ type: isNode ? 'local' : 'remote' },
			'using zk operator'
		)

		zkOperator = isNode
			? makeLocalSnarkJsZkOperator(logger)
			: makeRemoteSnarkJsZkOperator(
				DEFAULT_REMOTE_ZK_PARAMS,
				logger
			)
	}

	return zkOperator
}