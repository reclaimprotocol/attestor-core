import type {
	KOutputPayload,
	RequestRedactionRange,
	ResponseRedactionRange,
	TLS12CBCSessionBinding,
	TOutputPayload,
	VerificationBundle,
} from '#src/proto/tee-bundle.ts'
import { TLS12CBCRecordMode } from '#src/proto/tee-bundle.ts'
import { AttestorError } from '#src/utils/error.ts'

export type TeeProtocolMode = 'split-aead' | 'tls12-cbc'

const TLS12_CBC_CONTRACT_VERSION = 1
const TLS12_CBC_BINDING_SIZE = 32
const TLS12_CBC_DIGEST_SIZE = 32
const TLS12_MAX_PLAINTEXT = 16_384
const TLS12_MAX_RECORDS = 500
const MAX_HTTP_REQUEST_SIZE = 1 << 20
const MAX_REQUEST_REDACTIONS = 1_000
const MAX_RESPONSE_REDACTIONS = 1_000

const TLS12_CBC_CIPHER_SUITES = new Set([
	0xc009,
	0xc013,
	0xc00a,
	0xc014,
	0xc023,
	0xc027,
	0xc024,
	0xc028,
	0x002f,
	0x0035,
	0x003c,
	0x003d,
])

export function validateTeeTranscriptContract(
	bundle: VerificationBundle,
	kPayload: KOutputPayload,
	tPayload: TOutputPayload,
): TeeProtocolMode {
	const hasKContract = kPayload.tls12Cbc !== undefined
	const hasTContract = tPayload.tls12Cbc !== undefined

	if(hasKContract !== hasTContract) {
		throw invalidClaim('TLS 1.2 CBC contract must be present in both TEE payloads')
	}

	if(!hasKContract || !hasTContract) {
		validateLegacyContract(kPayload, tPayload)
		return 'split-aead'
	}

	validateTls12CbcContract(bundle, kPayload, tPayload)
	return 'tls12-cbc'
}

function validateLegacyContract(kPayload: KOutputPayload, tPayload: TOutputPayload): void {
	if(kPayload.consolidatedResponseKeystream.length === 0) {
		throw invalidClaim('Missing consolidated response keystream in TEE_K payload')
	}

	if(tPayload.consolidatedResponseCiphertext.length === 0) {
		throw invalidClaim('Missing consolidated response ciphertext in TEE_T payload')
	}
}

function validateTls12CbcContract(
	bundle: VerificationBundle,
	kPayload: KOutputPayload,
	tPayload: TOutputPayload,
): void {
	const kContract = kPayload.tls12Cbc!
	const tContract = tPayload.tls12Cbc!

	if(kPayload.redactedRequest.length !== 0 || kPayload.requestRedactionRanges.length !== 0 ||
		kPayload.consolidatedResponseKeystream.length !== 0 || kPayload.responseRedactionRanges.length !== 0) {
		throw invalidClaim('TEE_K TLS 1.2 CBC output mixes legacy split-AEAD fields')
	}

	if(tPayload.consolidatedResponseCiphertext.length !== 0 || tPayload.requestProofStreams.length !== 0) {
		throw invalidClaim('TEE_T TLS 1.2 CBC output mixes legacy split-AEAD fields')
	}

	if(bundle.oprfVerifications.length !== 0) {
		throw invalidClaim('TLS 1.2 CBC does not support legacy ZK TOPRF verification data')
	}

	validateBinding(kContract.binding, 'TEE_K')
	validateBinding(tContract.binding, 'TEE_T')
	if(!bindingsEqual(kContract.binding!, tContract.binding!)) {
		throw invalidClaim('TLS 1.2 CBC session binding mismatch between TEE_K and TEE_T')
	}

	if(kContract.authenticatedRedactedRequest.length === 0 ||
		kContract.authenticatedRedactedRequest.length > MAX_HTTP_REQUEST_SIZE) {
		throw invalidClaim('Invalid TLS 1.2 CBC authenticated request length')
	}

	if(kContract.requestRecordsSha256.length !== TLS12_CBC_DIGEST_SIZE) {
		throw invalidClaim('TLS 1.2 CBC request record digest must be 32 bytes')
	}

	validateRequestRanges(kContract.requestRedactionRanges, kContract.authenticatedRedactedRequest.length)

	const responseLength = tContract.authenticatedRedactedResponse.length
	if(responseLength === 0 || responseLength > TLS12_MAX_RECORDS * TLS12_MAX_PLAINTEXT) {
		throw invalidClaim('Invalid TLS 1.2 CBC authenticated response length')
	}

	if(tContract.responseRecordsSha256.length !== TLS12_CBC_DIGEST_SIZE) {
		throw invalidClaim('TLS 1.2 CBC response record digest must be 32 bytes')
	}

	validateResponseRanges(tContract.responseRedactionRanges, responseLength)
	validatePlaintextRecordLengths(tContract.plaintextRecordLengths, responseLength)
}

function validateBinding(binding: TLS12CBCSessionBinding | undefined, owner: string): void {
	if(!binding) {
		throw invalidClaim(`${owner} TLS 1.2 CBC binding is missing`)
	}

	if(binding.contractVersion !== TLS12_CBC_CONTRACT_VERSION) {
		throw invalidClaim(`${owner} TLS 1.2 CBC contract version is unsupported`)
	}

	if(!TLS12_CBC_CIPHER_SUITES.has(binding.cipherSuite)) {
		throw invalidClaim(`${owner} TLS 1.2 CBC cipher suite is unsupported`)
	}

	if(binding.recordMode !== TLS12CBCRecordMode.TLS12_CBC_RECORD_MODE_MAC_THEN_ENCRYPT &&
		binding.recordMode !== TLS12CBCRecordMode.TLS12_CBC_RECORD_MODE_ENCRYPT_THEN_MAC) {
		throw invalidClaim(`${owner} TLS 1.2 CBC record mode is invalid`)
	}

	if(binding.sessionBinding.length !== TLS12_CBC_BINDING_SIZE) {
		throw invalidClaim(`${owner} TLS 1.2 CBC session binding must be 32 bytes`)
	}
}

function bindingsEqual(a: TLS12CBCSessionBinding, b: TLS12CBCSessionBinding): boolean {
	return a.contractVersion === b.contractVersion &&
		a.cipherSuite === b.cipherSuite &&
		a.recordMode === b.recordMode &&
		a.extendedMasterSecret === b.extendedMasterSecret &&
		bytesEqual(a.sessionBinding, b.sessionBinding)
}

function validateRequestRanges(ranges: RequestRedactionRange[], requestLength: number): void {
	if(ranges.length > MAX_REQUEST_REDACTIONS) {
		throw invalidClaim('Too many TLS 1.2 CBC request redaction ranges')
	}

	for(const [index, range] of ranges.entries()) {
		if(range.start < 0 || range.length <= 0 || range.start > requestLength ||
			range.length > requestLength - range.start) {
			throw invalidClaim(`TLS 1.2 CBC request redaction range ${index} is out of bounds`)
		}

		if(range.type !== 'sensitive' && range.type !== 'sensitive_proof') {
			throw invalidClaim(`TLS 1.2 CBC request redaction range ${index} has invalid type`)
		}
	}

	validateNoOverlap(ranges, 'request')
}

function validateResponseRanges(ranges: ResponseRedactionRange[], responseLength: number): void {
	if(ranges.length > MAX_RESPONSE_REDACTIONS) {
		throw invalidClaim('Too many TLS 1.2 CBC response redaction ranges')
	}

	for(const [index, range] of ranges.entries()) {
		if(range.start < 0 || range.length <= 0 || range.start > responseLength ||
			range.length > responseLength - range.start) {
			throw invalidClaim(`TLS 1.2 CBC response redaction range ${index} is out of bounds`)
		}
	}

	validateNoOverlap(ranges, 'response')
}

function validateNoOverlap(
	ranges: Array<{ start: number, length: number }>,
	direction: 'request' | 'response',
): void {
	const sorted = [...ranges].sort((a, b) => a.start - b.start)
	for(let i = 1; i < sorted.length; i++) {
		const previous = sorted[i - 1]
		const current = sorted[i]
		if(current.start < previous.start + previous.length) {
			throw invalidClaim(`TLS 1.2 CBC ${direction} redaction ranges overlap`)
		}
	}
}

function validatePlaintextRecordLengths(lengths: number[], responseLength: number): void {
	if(lengths.length === 0 || lengths.length > TLS12_MAX_RECORDS) {
		throw invalidClaim('Invalid TLS 1.2 CBC plaintext record count')
	}

	let total = 0
	for(const [index, length] of lengths.entries()) {
		if(length < 0 || length > TLS12_MAX_PLAINTEXT) {
			throw invalidClaim(`TLS 1.2 CBC plaintext record length ${index} is invalid`)
		}
		total += length
	}

	if(total !== responseLength) {
		throw invalidClaim('TLS 1.2 CBC plaintext record lengths do not match the authenticated response')
	}
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if(a.length !== b.length) {
		return false
	}

	let difference = 0
	for(let i = 0; i < a.length; i++) {
		difference |= a[i] ^ b[i]
	}
	return difference === 0
}

function invalidClaim(message: string): AttestorError {
	return new AttestorError('ERROR_INVALID_CLAIM', message)
}
