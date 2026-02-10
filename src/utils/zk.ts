import type { CipherSuite } from '@reclaimprotocol/tls'
import { concatenateUint8Arrays, crypto, generateIV } from '@reclaimprotocol/tls'
import type {
	EncryptionAlgorithm,
	MakeOPRFOperator,
	MakeZKOperatorOpts,
	OPRFOperator,	PrivateInput,
	PublicInput,
	RawPublicInput,
	ZKEngine,
	ZKOperator,
	ZKTOPRFPublicSignals
} from '@reclaimprotocol/zk-symmetric-crypto'
import {
	ceilToBlockSizeMultiple,
	CONFIG as ZK_CONFIG,
	generateProof,
	getBlockSizeBytes,
	makeLocalFileFetch,
	makeRemoteFileFetch,
	verifyProof
} from '@reclaimprotocol/zk-symmetric-crypto'
import {
	makeGnarkOPRFOperator,
	makeGnarkZkOperator,
} from '@reclaimprotocol/zk-symmetric-crypto/gnark'
import { makeSnarkJsZKOperator } from '@reclaimprotocol/zk-symmetric-crypto/snarkjs'
import PQueue from 'p-queue'

import { DEFAULT_REMOTE_FILE_FETCH_BASE_URL, DEFAULT_ZK_CONCURRENCY, TOPRF_DOMAIN_SEPARATOR } from '#src/config/index.ts'
import type { MessageReveal_MessageRevealZk as ZKReveal, MessageReveal_TOPRFProof as TOPRFProof, MessageReveal_ZKProof as ZKProof } from '#src/proto/api.ts'
import { ZKProofEngine } from '#src/proto/api.ts'
import type { ArraySlice, CompleteTLSPacket, Logger, OPRFOperators, PrepareZKProofsBaseOpts, TOPRFProofParams, ZKOperators, ZKRevealInfo } from '#src/types/index.ts'
import { detectEnvironment, getEnvVariable } from '#src/utils/env.ts'
import { AttestorError } from '#src/utils/error.ts'
import { getPureCiphertext, getRecordIV, getZkAlgorithmForCipherSuite, isTls13Suite, strToUint8Array } from '#src/utils/generics.ts'
import { logger as LOGGER } from '#src/utils/logger.ts'
import { binaryHashToStr, isFullyRedacted, isRedactionCongruent, REDACTION_CHAR_CODE } from '#src/utils/redactions.ts'

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
}

type GenerateTOPRFChunkProofOpts = {
	key: Uint8Array
	iv: Uint8Array
	/**
	 * ciphertext obtained from the TLS packet
	 * includes authTag, record IV, and ciphertext
	 */
	ciphertext: Uint8Array

	slice: ArraySlice
	toprf: TOPRFProofParams
}

type PrepareZKProofsOpts = {
	logger?: Logger
	cipherSuite: CipherSuite
} & PrepareZKProofsBaseOpts

type ZKVerifyOpts = {
	cipherSuite: CipherSuite
	ciphertext: Uint8Array
	zkReveal: ZKReveal
	iv: Uint8Array
	recordNumber: number
	toprfOvershotNullifier?: Uint8Array
	/**
	 * Get the ciphertext of the next packet.
	 * @param overshotNullifier The TOPRF nullifier that overshoots into
	 * the next packet. This should be passed into the verifyZkPacket function
	 * of the next packet.
	 */
	getNextPacket: (overshotNullifier: Uint8Array) => (Uint8Array | undefined)

	logger?: Logger
	/** get ZK operator for specified algorithm */
	zkOperators?: ZKOperators
	oprfOperators?: OPRFOperators
	zkEngine?: ZKEngine
}

type ZKProofToGenerate = {
	startIdx: number
	redactedPlaintext: Uint8Array
	privateInput: PrivateInput
	publicInput: PublicInput
}

type TOPRFProofToGenerate = {
	privateInput: PrivateInput
	publicInput: PublicInput
	toprf: TOPRFProofParams
	startIdx: number
}

type ZKPacketToProve = {
	onGeneratedProofs(proofs: ZKProof[], toprfs: TOPRFProof[]): void
	algorithm: EncryptionAlgorithm
	proofsToGenerate: ZKProofToGenerate[]
	toprfsToGenerate: TOPRFProofToGenerate[]
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
	const zkQueue
		= new PQueue({ concurrency: zkProofConcurrency, autoStart: true })
	const packetsToProve: ZKPacketToProve[] = []

	logger = logger.child({ module: 'zk', zkEngine })
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
			{
				redactedPlaintext, toprfs = [], overshotToprfFromPrevBlock
			}: ZKRevealInfo,
			onGeneratedProofs: ZKPacketToProve['onGeneratedProofs'],
			getNextPacket: () => CompleteTLSPacket | undefined
		) {
			if(packet.type === 'plaintext') {
				throw new Error('Cannot generate proof for plaintext')
			}

			const alg = getZkAlgorithmForCipherSuite(cipherSuite)
			const chunkSizeBytes = getChunkSizeBytes(alg)

			const key = await crypto.exportKey(packet.encKey)
			const iv = packet.iv
			const ciphertext = getPureCiphertext(packet.ciphertext, cipherSuite)
			// if the packet starts with TOPRF overflow from previous packet,
			// we can just redact that part of the ciphertext as it's not required
			// to be proven. Decrypting the raw ciphertext of this part would also
			// reveal the raw underlying text, which we don't want.
			if(overshotToprfFromPrevBlock) {
				redactedPlaintext.set(
					new Uint8Array(overshotToprfFromPrevBlock.length)
						.fill(REDACTION_CHAR_CODE)
				)
			}

			const trueCiphertextLength = isTls13Suite(cipherSuite)
				? ciphertext.length - 1 // remove content type byte
				: ciphertext.length
			const packetToProve: ZKPacketToProve = {
				onGeneratedProofs,
				algorithm: alg,
				proofsToGenerate: [],
				toprfsToGenerate: [],
				iv: packet.fixedIv,
			}

			// first we'll handle all TOPRF blocks
			// we do these first, because they can span multiple chunks
			// & we need to be able to span the right chunks
			for(const toprf of toprfs) {
				// if the TOPRF data overshoots the ciphertext length,
				// then it means that the OPRF data is spread across multiple
				// TLS records & we need to include the next record's ciphertext
				// in our proof.
				// At most we support the OPRF data being spread across 2 records
				const toprfDistFromEnd = trueCiphertextLength
					- (toprf.dataLocation!.fromIndex + toprf.dataLocation!.length)
				if(toprfDistFromEnd < 0) {
					const nextPacket = getNextPacket()
					if(nextPacket?.type !== 'ciphertext') {
						throw new AttestorError(
							'ERROR_INTERNAL',
							'TOPRF data overshoots ciphertext length, '
							+ 'but no next ciphertext packet found'
						)
					}

					if(nextPacket.encKey !== packet.encKey) {
						throw new AttestorError(
							'ERROR_INTERNAL',
							'TOPRF data overshoots ciphertext length, '
							+ 'but next packet has different encryption key'
						)
					}

					const nextCiphertext = nextPacket.ciphertext
						.slice(0, Math.abs(toprfDistFromEnd))
					const iv = nextPacket.iv
					toprf.overshoot = {
						ciphertext: nextCiphertext,
						iv,
						recordNumber: nextPacket.recordNumber,
					}
				}

				const fromIndex = getIdealOffsetForToprfBlock(alg, toprf)
				const toIndex = Math
					.min(fromIndex + chunkSizeBytes, ciphertext.length)

				// ensure this OPRF block doesn't overlap with any other OPRF block
				const slice: ArraySlice = { fromIndex, toIndex }
				packetToProve.toprfsToGenerate.push(getTOPRFProofGenerationParamsForSlice({
					key,
					iv,
					ciphertext,
					slice,
					toprf: {
						...toprf,
						dataLocation: {
							...toprf.dataLocation!,
							fromIndex: toprf.dataLocation!.fromIndex - fromIndex
						}
					}
				}))
				zkProofsToGen += 1

				// we'll redact the OPRF part of the plaintext to not reveal
				// the actual plaintext to the attestor
				const pktToIndex = Math.min(
					trueCiphertextLength,
					toprf.dataLocation!.fromIndex + toprf.dataLocation!.length
				)
				const pktFromIndex = toprf.dataLocation!.fromIndex
				for(let i = pktFromIndex;i < pktToIndex;i++) {
					redactedPlaintext[i] = REDACTION_CHAR_CODE
				}
			}

			for(let i = 0;i < ciphertext.length;i += chunkSizeBytes) {
				const slice: ArraySlice = {
					fromIndex: i,
					toIndex: Math.min(i + chunkSizeBytes, ciphertext.length)
				}

				const proofParams = getProofGenerationParamsForSlice(
					{ key, iv, ciphertext, redactedPlaintext, slice }
				)

				if(!proofParams) {
					continue
				}

				packetToProve.proofsToGenerate.push(proofParams)
				zkProofsToGen += 1
			}

			packetsToProve.push(packetToProve)
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
			for(const {
				onGeneratedProofs, algorithm, proofsToGenerate, toprfsToGenerate
			} of packetsToProve) {
				const proofs: ZKProof[] = []
				const toprfs: TOPRFProof[] = []

				let proofsLeft = proofsToGenerate.length
				 + toprfsToGenerate.length
				for(const proofToGen of proofsToGenerate) {
					tasks.push(zkQueue.add(async() => {
						const proof = await generateZkProofForChunk(algorithm, proofToGen)

						onChunkDone?.()
						proofs.push(proof)

						proofsLeft -= 1
						if(proofsLeft === 0) {
							onGeneratedProofs(proofs, toprfs)
						}
					}, { throwOnTimeout: true }))
				}

				for(const toprfToGen of toprfsToGenerate) {
					tasks.push(zkQueue.add(async() => {
						const toprf = await generateOprfProofForChunk(algorithm, toprfToGen)

						onChunkDone?.()
						toprfs.push(toprf)

						proofsLeft -= 1
						if(proofsLeft === 0) {
							onGeneratedProofs(proofs, toprfs)
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

	async function generateZkProofForChunk(
		algorithm: EncryptionAlgorithm,
		{
			startIdx, redactedPlaintext, privateInput, publicInput
		}: ZKProofToGenerate
	): Promise<ZKProof> {
		const operator = getZkOperatorForAlgorithm(algorithm)
		const proof = await generateProof(
			{ algorithm, privateInput, publicInput, operator, logger }
		)

		logger?.debug({ startIdx }, 'generated proof for chunk')

		return {
			proofData: typeof proof.proofData === 'string'
				? strToUint8Array(proof.proofData)
				: proof.proofData,
			decryptedRedactedCiphertext: proof.plaintext || new Uint8Array(),
			redactedPlaintext,
			startIdx
		}
	}

	async function generateOprfProofForChunk(
		algorithm: EncryptionAlgorithm,
		{ startIdx, privateInput, publicInput, toprf }: TOPRFProofToGenerate
	): Promise<TOPRFProof> {
		const operator = getOprfOperatorForAlgorithm(algorithm)
		const toprfLocations: ZKTOPRFPublicSignals['locations'] = []
		if(toprf?.overshoot) {
			const { dataLocation, overshoot: { ciphertext }	} = toprf
			toprfLocations.push(
				{
					pos: dataLocation!.fromIndex,
					len: dataLocation!.length - ciphertext.length
				},
				{
					pos: ceilToBlockSizeMultiple(
						dataLocation!.fromIndex + dataLocation!.length,
						algorithm
					),
					len: ciphertext.length
				}
			)
		} else if(toprf) {
			toprfLocations.push({
				pos: toprf.dataLocation!.fromIndex,
				len: toprf.dataLocation!.length,
			})
		}

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
								locations: toprfLocations,
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

		logger?.debug({ toprfLocations }, 'generated TOPRF proof for chunk')

		return {
			startIdx,
			proofData: typeof proof.proofData === 'string'
				? strToUint8Array(proof.proofData)
				: proof.proofData,
			payload: toprf,
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
		recordNumber,
		toprfOvershotNullifier,
		getNextPacket
	}: ZKVerifyOpts,
) {
	const { proofs, toprfs } = zkReveal
	const algorithm = getZkAlgorithmForCipherSuite(cipherSuite)

	const recordIV = getRecordIV(ciphertext, cipherSuite)
	ciphertext = new Uint8Array(getPureCiphertext(ciphertext, cipherSuite))
	const realRedactedPlaintext
		= new Uint8Array(ciphertext.length).fill(REDACTION_CHAR_CODE)

	const replacements = await Promise.all(toprfs.map(async(toprf, i) => {
		try {
			return await verifyToprfProofPacket(toprf)
		} catch(e) {
			e.message += ` (TOPRF proof ${i}, `
				+ `from ${toprf.payload?.dataLocation?.fromIndex}, `
				+ `record ${recordNumber})`
			throw e
		}
	}))

	await Promise.all(proofs.map(async(proof, i) => {
		try {
			await verifyZkProofPacket(proof)
		} catch(e) {
			e.message +=
				` (ZK proof ${i}, startIdx ${proof.startIdx}, record ${recordNumber})`
			throw e
		}
	}))

	for(const { set, startIdx } of replacements) {
		realRedactedPlaintext.set(set, startIdx)
	}

	/**
	 * to verify if the user has given us the correct redacted plaintext,
	 * and isn't providing plaintext that they haven't proven they have
	 * we start with a fully redacted plaintext, and then replace the
	 * redacted parts with the plaintext that the user has provided
	 * in the proofs
	 */
	if(toprfOvershotNullifier) {
		realRedactedPlaintext.set(toprfOvershotNullifier)
	}

	return { redactedPlaintext: realRedactedPlaintext }

	async function verifyZkProofPacket(
		{
			proofData,
			decryptedRedactedCiphertext,
			redactedPlaintext,
			startIdx,
		}: ZKProof,
	) {
		// get the ciphertext chunk we received from the server
		// the ZK library, will verify that the decrypted redacted
		// ciphertext matches the ciphertext received from the server
		const ciphertextChunkEnd = startIdx + redactedPlaintext.length
		const ciphertextChunk = ciphertext.slice(startIdx, ciphertextChunkEnd)
		// redact ciphertext if plaintext is redacted
		// to prepare for decryption in ZK circuit
		// the ZK circuit will take in the redacted ciphertext,
		// which shall produce the redacted plaintext
		for(let i = 0;i < ciphertextChunk.length;i++) {
			if(redactedPlaintext[i] === REDACTION_CHAR_CODE) {
				ciphertextChunk[i] = REDACTION_CHAR_CODE
			}
		}

		let nonce = concatenateUint8Arrays([iv, recordIV])
		if(!recordIV.length) {
			nonce = generateIV(nonce, recordNumber)
		}

		const ciphertextInput: RawPublicInput = {
			ciphertext: ciphertextChunk,
			iv: nonce,
			offsetBytes: startIdx
		}
		if(
			!isRedactionCongruent(redactedPlaintext, decryptedRedactedCiphertext)
		) {
			throw new Error('redacted ciphertext not congruent')
		}

		await verifyProof(
			{
				proof: {
					algorithm,
					proofData: proofData,
					plaintext: decryptedRedactedCiphertext,
				},
				publicInput: ciphertextInput,
				logger,
				operator: getZkOperator()
			}
		)

		logger?.debug(
			{ startIdx, endIdx: startIdx + redactedPlaintext.length },
			'verified proof'
		)

		realRedactedPlaintext.set(redactedPlaintext, startIdx)
	}

	async function verifyToprfProofPacket(
		{ startIdx, proofData, payload: toprf }: TOPRFProof,
	) {
		if(!toprf?.dataLocation || !toprf.responses || !toprf.nullifier) {
			throw new Error('invalid TOPRF proof payload')
		}

		const { dataLocation, nullifier } = toprf
		const ciphertextChunkEnd = Math
			.min(ciphertext.length, getChunkSizeBytes(algorithm) + startIdx)
		const isLastChunk = ciphertextChunkEnd >= ciphertext.length
		const ciphertextChunk = ciphertext.slice(startIdx, ciphertextChunkEnd)

		let nonce = concatenateUint8Arrays([iv, recordIV])
		if(!recordIV.length) {
			nonce = generateIV(nonce, recordNumber)
		}

		const ciphertextInput: RawPublicInput = {
			ciphertext: ciphertextChunk,
			iv: nonce,
			offsetBytes: startIdx
		}
		let pubInput: PublicInput = ciphertextInput
		const nulliferStr = binaryHashToStr(nullifier, dataLocation.length)

		const locations: ZKTOPRFPublicSignals['locations'] = []

		const toprfEndIdx = dataLocation.fromIndex + dataLocation.length
		const trueCiphLen = isLastChunk && isTls13Suite(cipherSuite)
			? ciphertextChunk.length - 1
			: ciphertextChunk.length
		const overshoot = toprfEndIdx - trueCiphLen
		if(overshoot > 0) {
			// fetch the overshoot part of the nullifier
			const nextPkt = getNextPacket(
				strToUint8Array(nulliferStr.slice(dataLocation.length - overshoot))
			)
			if(!nextPkt) {
				throw new Error('OPRF data overshot, but no next packet found')
			}

			const nextRecordIV = getRecordIV(ciphertext, cipherSuite)
			let nextNonce = concatenateUint8Arrays([iv, nextRecordIV])
			if(!nextRecordIV.length) {
				nextNonce = generateIV(nextNonce, recordNumber + 1)
			}

			pubInput = [
				ciphertextInput,
				{
					ciphertext: nextPkt.slice(0, overshoot),
					iv: nextNonce,
					offsetBytes: 0,
				}
			]

			locations.push(
				{
					pos: dataLocation.fromIndex,
					len: dataLocation.length - overshoot
				},
				{
					pos: ceilToBlockSizeMultiple(
						dataLocation.fromIndex + dataLocation.length,
						algorithm
					),
					len: overshoot
				}
			)
		} else {
			locations.push({
				pos: dataLocation.fromIndex,
				len: dataLocation.length,
			})
		}

		await verifyProof(
			{
				proof: { algorithm, proofData: proofData, plaintext: undefined },
				publicInput: pubInput,
				logger,
				operator: getOprfOperator(),
				toprf: {
					locations,
					domainSeparator: TOPRF_DOMAIN_SEPARATOR,
					output: nullifier,
					responses: toprf.responses,
				}
			}
		)

		logger?.debug({ locations }, 'verified TOPRF proof')

		return {
			set: strToUint8Array(
				nulliferStr.slice(0, locations[0].len)
			),
			startIdx: locations[0].pos + startIdx,
		}
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
		const opType = getOperatorType()
		const zkBaseUrl = opType === 'remote' ? getZkResourcesBaseUrl()	: undefined

		logger?.info({ type: opType, algorithm, zkBaseUrl }, 'fetching zk operator')

		const fetcher = opType === 'local'
			? makeLocalFileFetch()
			: makeRemoteFileFetch({ baseUrl: zkBaseUrl, logger })
		const maker = operatorMakers[zkEngine]
		if(!maker) {
			throw new Error(`No ZK operator maker for ${zkEngine}`)
		}

		zkOperators[algorithm] = maker({ algorithm, fetcher })
	}

	return zkOperators[algorithm]
}

function getOperatorType() {
	const envop = getEnvVariable('ZK_OPERATOR_TYPE')
	if(envop === 'local' || envop === 'remote') {
		return envop
	}

	return detectEnvironment() === 'node' ? 'local' : 'remote'
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
		const type = getOperatorType()
		const zkBaseUrl = type === 'remote' ? getZkResourcesBaseUrl() : undefined

		logger?.info({ type, algorithm, zkBaseUrl }, 'fetching oprf operator')

		const fetcher = type === 'local'
			? makeLocalFileFetch()
			: makeRemoteFileFetch({ baseUrl: zkBaseUrl, logger })
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
	}
}

function getTOPRFProofGenerationParamsForSlice(
	{
		key,
		iv,
		ciphertext,
		slice: { fromIndex, toIndex },
		toprf,
	}: GenerateTOPRFChunkProofOpts,
): TOPRFProofToGenerate {
	const ciphertextChunk = ciphertext.slice(fromIndex, toIndex)
	if(toprf?.overshoot) {
		const {
			overshoot: { ciphertext: overshootCiphertext, iv: overshootIv }
		} = toprf
		return {
			privateInput: { key },
			publicInput: [
				{
					ciphertext: ciphertextChunk,
					iv,
					offsetBytes: fromIndex,
				},
				{ ciphertext: overshootCiphertext, iv: overshootIv }
			],
			toprf,
			startIdx: fromIndex,
		}
	}

	return {
		privateInput: { key },
		publicInput: { ciphertext: ciphertextChunk, iv, offsetBytes: fromIndex },
		toprf,
		startIdx: fromIndex,
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
	{ dataLocation, overshoot }: TOPRFProofParams,
) {
	const chunkSizeBytes = getChunkSizeBytes(alg)
	const blockSizeBytes = getBlockSizeBytes(alg)
	const offsetChunks = Math
		.floor(dataLocation!.fromIndex / chunkSizeBytes)
	const endOffsetChunks = Math
		.floor((dataLocation!.fromIndex + dataLocation!.length) / chunkSizeBytes)
	// happy case -- the OPRF block fits into a single chunk, that's a
	// divisor of the chunk size
	if(endOffsetChunks === offsetChunks) {
		const start = offsetChunks * chunkSizeBytes
		if(overshoot) {
			const overshootBlocks = Math
				.ceil(overshoot.ciphertext.length / blockSizeBytes)
			return start + (overshootBlocks * blockSizeBytes)
		}

		return start
	}

	const offsetBytes = Math
		.floor(dataLocation!.fromIndex / blockSizeBytes) * blockSizeBytes
	const endOffsetBytes = Math
		.ceil((dataLocation!.fromIndex + dataLocation!.length) / blockSizeBytes)
	if(endOffsetBytes - offsetBytes > chunkSizeBytes) {
		throw new AttestorError(
			'ERROR_BAD_REQUEST',
			'OPRF data cannot fit into a single chunk'
		)
	}

	return offsetBytes
}

function getZkResourcesBaseUrl() {
	if(typeof ATTESTOR_BASE_URL !== 'string') {
		return DEFAULT_REMOTE_FILE_FETCH_BASE_URL
	}

	return new URL(
		DEFAULT_REMOTE_FILE_FETCH_BASE_URL,
		ATTESTOR_BASE_URL
	).toString()
}
