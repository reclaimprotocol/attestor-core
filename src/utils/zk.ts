import { CipherSuite, concatenateUint8Arrays, crypto, generateIV, strToUint8Array } from '@reclaimprotocol/tls'
import {
	CONFIG as ZK_CONFIG,
	EncryptionAlgorithm,
	generateProof,
	getBlockSizeBytes,
	makeLocalFileFetch,
	MakeOPRFOperator,
	makeRemoteFileFetch,
	MakeZKOperatorOpts,
	OPRFOperator,	PrivateInput,
	PublicInput,
	verifyProof,
	ZKEngine,
	ZKOperator
} from '@reclaimprotocol/zk-symmetric-crypto'
import {
	makeGnarkOPRFOperator,
	makeGnarkZkOperator,
} from '@reclaimprotocol/zk-symmetric-crypto/gnark'
import { makeSnarkJsZKOperator } from '@reclaimprotocol/zk-symmetric-crypto/snarkjs'
import { DEFAULT_REMOTE_FILE_FETCH_BASE_URL, DEFAULT_ZK_CONCURRENCY, TOPRF_DOMAIN_SEPARATOR } from 'src/config/index.ts'
import { MessageReveal_MessageRevealZk as ZKReveal, MessageReveal_ZKProof as ZKProof, ZKProofEngine } from 'src/proto/api.ts'
import { ArraySlice, CompleteTLSPacket, Logger, OPRFOperators, PrepareZKProofsBaseOpts, TOPRFProofParams, ZKOperators, ZKRevealInfo } from 'src/types/index.ts'
import { detectEnvironment, getEnvVariable } from 'src/utils/env.ts'
import { AttestorError } from 'src/utils/error.ts'
import { getPureCiphertext, getRecordIV, getZkAlgorithmForCipherSuite, uint8ArrayToStr } from 'src/utils/generics.ts'
import { logger as LOGGER } from 'src/utils/logger.ts'
import { binaryHashToStr, isFullyRedacted, isRedactionCongruent, REDACTION_CHAR_CODE } from 'src/utils/redactions.ts'

type GenerateZKChunkProofOpts = {
	key: Uint8Array
	iv: Uint8Array
	/**
	 * ciphertext obtained from the TLS packet
	 * includes authTag, record IV, and ciphertext
	 */
	ciphertext: Uint8Array
	redactedPlaintext: Uint8Array

	slice: ArraySlice

	toprf?: TOPRFProofParams
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
	oprfOperators?: OPRFOperators
	zkEngine?: ZKEngine
	iv: Uint8Array
	recordNumber: number
}

type ZKProofToGenerate = {
	startIdx: number
	redactedPlaintext: Uint8Array
	privateInput: PrivateInput
	publicInput: PublicInput
	toprf?: TOPRFProofParams
}

type ZKPacketToProve = {
	onGeneratedProofs(proofs: ZKProof[]): void
	algorithm: EncryptionAlgorithm
	proofsToGenerate: ZKProofToGenerate[]
	iv: Uint8Array
}

const ZK_CONCURRENCY = +(
	getEnvVariable('ZK_CONCURRENCY') || DEFAULT_ZK_CONCURRENCY
)

export async function makeZkProofGenerator(
	{
		zkOperators,
		oprfOperators,
		logger = LOGGER,
		zkProofConcurrency = ZK_CONCURRENCY,
		cipherSuite,
		zkEngine = 'snarkjs'
	}: PrepareZKProofsOpts
) {

	const { default: PQueue } = await import('p-queue')
	const zkQueue = new PQueue({
		concurrency: zkProofConcurrency,
		autoStart: true,
	})

	const packetsToProve: ZKPacketToProve[] = []

	logger = (logger || LOGGER).child({ module: 'zk', zkEngine: zkEngine })
	let zkProofsToGen = 0

	return {
		/**
		 * Adds the given packet to the list of packets to
		 * generate ZK proofs for.
		 *
		 * Call `generateProofs()` to finally generate the proofs
		 */
		async addPacketToProve(
			packet: CompleteTLSPacket,
			{ redactedPlaintext, toprfs }: ZKRevealInfo,
			onGeneratedProofs: ZKPacketToProve['onGeneratedProofs']
		) {
			if(packet.type === 'plaintext') {
				throw new Error('Cannot generate proof for plaintext')
			}

			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const chunkSizeBytes = getChunkSizeBytes(alg)

			const key = await crypto.exportKey(packet.encKey)
			const iv = packet.iv
			const ciphertext = getPureCiphertext(
				packet.ciphertext,
				cipherSuite
			)
			const packetToProve: ZKPacketToProve = {
				onGeneratedProofs,
				algorithm: alg,
				proofsToGenerate: [],
				iv: packet.fixedIv,
			}
			const slicesDone: ArraySlice[] = []
			// first we'll handle all TOPRF blocks
			// we do these first, because they can span multiple chunks
			// & we need to be able to span the right chunks
			for(const toprf of toprfs || []) {
				if(
					toprf.dataLocation!.fromIndex + toprf.dataLocation!.length
						> ciphertext.length
				) {
					throw new AttestorError(
						'ERROR_TOPRF_OUT_OF_BOUNDS',
						'OPRF data spread across multiple chunks, please '
						+ 'retry the request. If this error persists, '
						+ 'try a different cipher suite, or try manipulating the location'
						+ ' of the OPRF data in the TLS packet.'
					)
				}

				const fromIndex = getIdealOffsetForToprfBlock(alg, toprf)
				const toIndex = Math.min(fromIndex + chunkSizeBytes, ciphertext.length)

				// ensure this OPRF block doesn't overlap with any other OPRF block
				const slice: ArraySlice = { fromIndex, toIndex }
				assertNoOverlapOprf(slice)

				addProofsToGenerate(
					slice,
					{
						...toprf,
						dataLocation: {
							...toprf.dataLocation!,
							fromIndex: toprf.dataLocation!.fromIndex - fromIndex
						}
					}
				)
			}

			// now we'll go through the rest of the ciphertext, and add proofs
			// for the sections that haven't been covered by the TOPRF blocks
			const slicesCp = sortSlices(slicesDone.slice())
			let fromIndex = 0
			for(const done of slicesCp) {
				if(done.fromIndex > fromIndex) {
					addProofsToGenerate({
						fromIndex,
						toIndex: done.fromIndex
					})
				}

				fromIndex = done.toIndex
			}

			if(fromIndex < ciphertext.length) {
				addProofsToGenerate({
					fromIndex,
					toIndex: ciphertext.length
				})
			}

			// generate proofs in order of start index
			packetToProve.proofsToGenerate
				.sort((a, b) => a.startIdx - b.startIdx)
			packetsToProve.push(packetToProve)

			function assertNoOverlapOprf(slice: ArraySlice) {
				for(const done of slicesDone) {
					if(
						// 1d box overlap
						slice.fromIndex < done.toIndex
							&& slice.toIndex > done.fromIndex
					) {
						throw new AttestorError(
							'ERROR_BAD_REQUEST',
							'Single chunk has multiple OPRFs'
						)
					}
				}
			}

			function addProofsToGenerate(
				{ fromIndex, toIndex }: ArraySlice,
				toprf?: TOPRFProofParams
			) {
				for(let i = fromIndex;i < toIndex;i += chunkSizeBytes) {
					const slice: ArraySlice = {
						fromIndex: i,
						toIndex: Math.min(i + chunkSizeBytes, toIndex)
					}

					slicesDone.push(slice)
					const proofParams = getProofGenerationParamsForSlice(
						{
							key,
							iv,
							ciphertext,
							redactedPlaintext,
							slice,
							toprf,
						},
					)

					if(!proofParams) {
						continue
					}

					packetToProve.proofsToGenerate.push(proofParams)
					zkProofsToGen += 1
				}
			}
		},
		getTotalChunksToProve() {
			return zkProofsToGen
		},
		async generateProofs(onChunkDone?: () => void) {
			if(!packetsToProve.length) {
				return
			}

			const start = Date.now()
			const tasks: Promise<void>[] = []
			for(const { onGeneratedProofs, algorithm, proofsToGenerate } of packetsToProve) {
				const proofs: ZKProof[] = []

				let proofsLeft = proofsToGenerate.length
				for(const proofToGen of proofsToGenerate) {
					tasks.push(zkQueue.add(async() => {
						const proof = await generateProofForChunk(algorithm, proofToGen)

						onChunkDone?.()
						proofs.push(proof)

						proofsLeft -= 1
						if(proofsLeft === 0) {
							onGeneratedProofs(proofs)
						}
					}, { throwOnTimeout: true }))
				}
			}

			await Promise.all(tasks)

			logger?.info(
				{ durationMs: Date.now() - start, zkProofsToGen },
				'generated ZK proofs'
			)

			// reset the packets to prove
			packetsToProve.splice(0, packetsToProve.length)
			zkProofsToGen = 0

			// release ZK resources to free up memory
			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const zkOperator = await getZkOperatorForAlgorithm(alg)
			zkOperator.release?.()
		},
	}

	async function generateProofForChunk(
		algorithm: EncryptionAlgorithm,
		{
			startIdx, redactedPlaintext,
			privateInput, publicInput,
			toprf,
		}: ZKProofToGenerate
	): Promise<ZKProof> {
		const operator = toprf
			? getOprfOperatorForAlgorithm(algorithm)
			: getZkOperatorForAlgorithm(algorithm)
		const proof = await generateProof(
			{
				algorithm,
				privateInput,
				publicInput,
				operator,
				logger,
				...(
					toprf
						? {
							toprf: {
								pos: toprf.dataLocation!.fromIndex,
								len: toprf.dataLocation!.length,
								output: toprf.nullifier,
								responses: toprf.responses,
								domainSeparator: TOPRF_DOMAIN_SEPARATOR
							},
							mask: toprf.mask,
						}
						: {}
				)
			}
		)

		logger?.debug({ startIdx }, 'generated proof for chunk')

		return {
			// backwards compatibility
			proofJson: '',
			proofData: typeof proof.proofData === 'string'
				? strToUint8Array(proof.proofData)
				: proof.proofData,
			toprf,
			decryptedRedactedCiphertext: proof.plaintext,
			redactedPlaintext,
			startIdx
		}
	}

	function getZkOperatorForAlgorithm(algorithm: EncryptionAlgorithm) {
		return zkOperators?.[algorithm]
			|| makeDefaultZkOperator(algorithm, zkEngine, logger)
	}

	function getOprfOperatorForAlgorithm(algorithm: EncryptionAlgorithm) {
		return oprfOperators?.[algorithm]
			|| makeDefaultOPRFOperator(algorithm, zkEngine, logger)
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
		oprfOperators,
		logger = LOGGER,
		zkEngine = 'snarkjs',
		iv,
		recordNumber
	}: ZKVerifyOpts,
) {
	if(!zkReveal) {
		throw new Error('No ZK reveal')
	}

	const { proofs } = zkReveal
	const algorithm = getZkAlgorithmForCipherSuite(cipherSuite)

	const recordIV = getRecordIV(ciphertext, cipherSuite)
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
		proofs.map(async(proof, i) => {
			try {
				await verifyProofPacket(proof)
			} catch(e) {
				e.message += ` (chunk ${i}, startIdx ${proof.startIdx})`
				throw e
			}
		})
	)

	return { redactedPlaintext: realRedactedPlaintext }

	async function verifyProofPacket(
		{
			proofData,
			proofJson,
			decryptedRedactedCiphertext,
			redactedPlaintext,
			startIdx,
			toprf,
		}: ZKProof,
	) {
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

		// redact OPRF indices -- because they'll incorrectly
		// be marked as incongruent
		let comparePlaintext = redactedPlaintext
		if(toprf) {
			comparePlaintext = new Uint8Array(redactedPlaintext)
			for(let i = 0;i < toprf.dataLocation!.length;i++) {
				comparePlaintext[
					i + toprf.dataLocation!.fromIndex
				] = REDACTION_CHAR_CODE
			}

			// the transcript will contain only the stringified
			// nullifier. So here, we'll compare the provable
			// binary nullifier with the stringified nullifier
			// that the user has provided
			const nulliferStr = binaryHashToStr(
				toprf.nullifier,
				toprf.dataLocation!.length
			)
			const txtHash = redactedPlaintext.slice(
				toprf.dataLocation?.fromIndex,
				toprf.dataLocation?.fromIndex!
					+ toprf.dataLocation?.length!
			)
			if(
				uint8ArrayToStr(txtHash) !== nulliferStr
					.slice(0, txtHash.length)
			) {
				throw new Error('OPRF nullifier not congruent')
			}
		}

		if(!isRedactionCongruent(
			comparePlaintext,
			decryptedRedactedCiphertext
		)) {
			throw new Error('redacted ciphertext not congruent')
		}

		let nonce = concatenateUint8Arrays([iv, recordIV])
		if(!recordIV.length) {
			nonce = generateIV(nonce, recordNumber)
		}

		await verifyProof(
			{
				proof: {
					algorithm,
					proofData: proofData.length
						? proofData
						: strToUint8Array(proofJson),
					plaintext: decryptedRedactedCiphertext,
				},
				publicInput: {
					ciphertext: ciphertextChunk,
					iv: nonce,
					offsetBytes: startIdx
				},
				logger,
				...(
					toprf
						? {
							operator: getOprfOperator(),
							toprf: {
								pos: toprf.dataLocation!.fromIndex,
								len: toprf.dataLocation!.length,
								domainSeparator: TOPRF_DOMAIN_SEPARATOR,
								output: toprf.nullifier,
								responses: toprf.responses,
							}
						}
						: { operator: getZkOperator() }
				)
			}
		)

		logger?.debug(
			{ startIdx, endIdx: startIdx + redactedPlaintext.length },
			'verified proof'
		)

		realRedactedPlaintext.set(redactedPlaintext, startIdx)
	}

	function getZkOperator() {
		return zkOperators?.[algorithm]
			|| makeDefaultZkOperator(algorithm, zkEngine, logger)
	}

	function getOprfOperator() {
		return oprfOperators?.[algorithm]
			|| makeDefaultOPRFOperator(algorithm, zkEngine, logger)
	}
}

// the chunk size of the ZK circuit in bytes
// this will be >= the block size
function getChunkSizeBytes(alg: EncryptionAlgorithm) {
	const { chunkSize, bitsPerWord } = ZK_CONFIG[alg]
	return chunkSize * bitsPerWord / 8
}

const zkEngines: {
	[z in ZKEngine]?: { [E in EncryptionAlgorithm]?: ZKOperator }
} = {}

const oprfEngines: {
	[z in ZKEngine]?: { [E in EncryptionAlgorithm]?: OPRFOperator }
} = {}

const operatorMakers: { [z in ZKEngine]?: (opts: MakeZKOperatorOpts<{}>) => ZKOperator } = {
	'snarkjs': makeSnarkJsZKOperator,
	'gnark': makeGnarkZkOperator,
}

const OPRF_OPERATOR_MAKERS: { [z in ZKEngine]?: MakeOPRFOperator<{}> } = {
	'gnark': makeGnarkOPRFOperator
}

export function makeDefaultZkOperator(
	algorithm: EncryptionAlgorithm,
	zkEngine: ZKEngine,
	logger: Logger,
) {
	let zkOperators = zkEngines[zkEngine]
	if(!zkOperators) {
		zkEngines[zkEngine] = {}
		zkOperators = zkEngines[zkEngine]
	}

	if(!zkOperators[algorithm]) {
		const isNode = detectEnvironment() === 'node'
		const opType = isNode ? 'local' : 'remote'
		const zkBaseUrl = opType === 'remote' ? getZkResourcesBaseUrl()	: undefined

		logger?.info({ type: opType, algorithm, zkBaseUrl }, 'fetching zk operator')

		const fetcher = opType === 'local'
			? makeLocalFileFetch()
			: makeRemoteFileFetch({ baseUrl: zkBaseUrl })
		const maker = operatorMakers[zkEngine]
		if(!maker) {
			throw new Error(`No ZK operator maker for ${zkEngine}`)
		}

		zkOperators[algorithm] = maker({ algorithm, fetcher })
	}

	return zkOperators[algorithm]
}

export function makeDefaultOPRFOperator(
	algorithm: EncryptionAlgorithm,
	zkEngine: ZKEngine,
	logger: Logger,
) {
	let operators = oprfEngines[zkEngine]
	if(!operators) {
		oprfEngines[zkEngine] = {}
		operators = oprfEngines[zkEngine]
	}

	if(!operators[algorithm]) {
		const isNode = detectEnvironment() === 'node'
		const type = isNode ? 'local' : 'remote'
		const zkBaseUrl = type === 'remote' ? getZkResourcesBaseUrl() : undefined

		logger?.info({ type, algorithm, zkBaseUrl }, 'fetching oprf operator')

		const fetcher = type === 'local'
			? makeLocalFileFetch()
			: makeRemoteFileFetch({ baseUrl: zkBaseUrl })
		const maker = OPRF_OPERATOR_MAKERS[zkEngine]
		if(!maker) {
			throw new Error(`No OPRF operator maker for ${zkEngine}`)
		}

		operators[algorithm] = maker({ algorithm, fetcher })
	}

	return operators[algorithm]
}

export function getEngineString(engine: ZKProofEngine) {
	if(engine === ZKProofEngine.ZK_ENGINE_GNARK) {
		return 'gnark'
	}

	if(engine === ZKProofEngine.ZK_ENGINE_SNARKJS) {
		return 'snarkjs'
	}

	throw new Error(`Unknown ZK engine: ${engine}`)
}


export function getEngineProto(engine: ZKEngine) {
	if(engine === 'gnark') {
		return ZKProofEngine.ZK_ENGINE_GNARK
	}

	if(engine === 'snarkjs') {
		return ZKProofEngine.ZK_ENGINE_SNARKJS
	}

	throw new Error(`Unknown ZK engine: ${engine}`)
}

function getProofGenerationParamsForSlice(
	{
		key,
		iv,
		ciphertext,
		redactedPlaintext,
		slice: { fromIndex, toIndex },
		toprf,
	}: GenerateZKChunkProofOpts,
): ZKProofToGenerate | undefined {
	const ciphertextChunk = ciphertext.slice(fromIndex, toIndex)
	const plaintextChunk = redactedPlaintext.slice(fromIndex, toIndex)
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
		startIdx: fromIndex,
		redactedPlaintext: plaintextChunk,
		privateInput: { key },
		publicInput: { ciphertext: ciphertextChunk, iv, offsetBytes: fromIndex },
		toprf
	}
}

/**
 * Get the ideal location to generate a ZK proof for a TOPRF block.
 * Ideally it should be put into a slice that's a divisor of the chunk size,
 * as that'll minimize the number of proofs that need to be generated.
 * @returns the offset in bytes
 */
function getIdealOffsetForToprfBlock(
	alg: EncryptionAlgorithm,
	{ dataLocation }: TOPRFProofParams,
) {
	const chunkSizeBytes = getChunkSizeBytes(alg)
	const offsetChunks = Math.floor(
		dataLocation!.fromIndex / chunkSizeBytes
	)
	const endOffsetChunks = Math.floor(
		(dataLocation!.fromIndex + dataLocation!.length) / chunkSizeBytes
	)

	// happy case -- the OPRF block fits into a single chunk, that's a
	// divisor of the chunk size
	if(endOffsetChunks === offsetChunks) {
		return offsetChunks * chunkSizeBytes
	}

	const blockSizeBytes = getBlockSizeBytes(alg)
	const offsetBytes = Math.floor(
		dataLocation!.fromIndex / blockSizeBytes
	) * blockSizeBytes
	const endOffsetBytes = Math.ceil(
		(dataLocation!.fromIndex + dataLocation!.length) / blockSizeBytes
	)
	if(endOffsetBytes - offsetBytes > chunkSizeBytes) {
		throw new AttestorError(
			'ERROR_BAD_REQUEST',
			'OPRF data cannot fit into a single chunk'
		)
	}

	return offsetBytes
}

function getZkResourcesBaseUrl() {
	return typeof window !== 'undefined' && window.WINDOW_RPC_ATTESTOR_BASE_URL
		? new URL(
			DEFAULT_REMOTE_FILE_FETCH_BASE_URL,
			window.WINDOW_RPC_ATTESTOR_BASE_URL
		).toString()
		: DEFAULT_REMOTE_FILE_FETCH_BASE_URL
}

function sortSlices(slices: ArraySlice[]) {
	return slices.sort((a, b) => a.fromIndex - b.fromIndex)
}