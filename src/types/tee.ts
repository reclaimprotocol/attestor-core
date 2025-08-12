/**
 * TypeScript definitions for TEE+MPC protocol integration
 * Based on proto definitions from reclaim-tee/proto/
 */

// ===== PROTOBUF STRUCTURE DEFINITIONS =====

export interface HandshakeSecrets {
	handshakeKey: Uint8Array
	handshakeIv: Uint8Array
	cipherSuite: number // uint16 fits here
	algorithm: string
}

export interface Opening {
	proofStream: Uint8Array // Str_SP
	proofKey: Uint8Array // K_SP
}

export interface RequestRedactionRange {
	start: number
	length: number
}

export interface ResponseRedactionRange {
	start: number
	length: number
}

export interface SignedRedactedDecryptionStream {
	seqNum: number
	redactedStream: Uint8Array
}

export interface KOutputPayload {
	redactedRequest: Uint8Array
	requestRedactionRanges: RequestRedactionRange[]
	redactedStreams: SignedRedactedDecryptionStream[]
	packets: Uint8Array[] // TLS handshake packets observed by TEE_K
	responseRedactionRanges: ResponseRedactionRange[]
}

export interface TOutputPayload {
	packets: Uint8Array[] // TLS packets observed by TEE_T
}

export interface AttestationReport {
	type: string // "nitro" or "gcp"
	report: Uint8Array // raw provider-specific attestation bytes
}

export const BodyType = {
	BODY_TYPE_UNSPECIFIED: 0,
	BODY_TYPE_K_OUTPUT: 1,
	BODY_TYPE_T_OUTPUT: 2,
} as const

export type BodyType = typeof BodyType[keyof typeof BodyType]

export interface SignedMessage {
	bodyType: BodyType
	body: Uint8Array // serialized deterministic KOutputPayload or TOutputPayload
	publicKey: Uint8Array // DER-encoded public key (standalone mode only)
	signature: Uint8Array // signature over body bytes
	attestationReport?: AttestationReport // full attestation (enclave mode only)
}

export interface VerificationBundlePB {
	handshakeKeys?: HandshakeSecrets // optional
	teekSigned: SignedMessage // BODY_TYPE_K_OUTPUT
	teetSigned: SignedMessage // BODY_TYPE_T_OUTPUT
	opening?: Opening // optional
	attestationTeeK?: Uint8Array // Optional attestation documents
	attestationTeeT?: Uint8Array
}

// ===== NITRO ATTESTATION STRUCTURES =====

export interface AttestationDocument {
	module_id: string
	digest: string
	timestamp: bigint
	pcrs: { [key: number]: Buffer }
	certificate: Buffer
	cabundle: Buffer[]
	public_key?: Buffer
	user_data?: Buffer
	nonce?: Buffer
}

export interface NitroValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
	extractedPublicKey?: Uint8Array
	userDataType?: 'tee_k' | 'tee_t'
	ethAddress?: string // ETH address extracted from user_data
}

// ===== TEE BUNDLE PROCESSING STRUCTURES =====

export interface TeeBundleData {
	teekSigned: SignedMessage // TEE_K SignedMessage
	teetSigned: SignedMessage // TEE_T SignedMessage
	teekPublicKey: Uint8Array // Extracted from attestation
	teetPublicKey: Uint8Array // Extracted from attestation
	kOutputPayload: KOutputPayload // Parsed TEE_K payload
	tOutputPayload: TOutputPayload // Parsed TEE_T payload
	handshakeKeys?: HandshakeSecrets // Optional handshake secrets
	opening?: Opening // Optional proof stream
}

export interface TeeTranscriptData {
	handshakePackets: Uint8Array[]
	applicationDataPackets: Uint8Array[]
	revealedRequest: Uint8Array
	reconstructedResponse: Uint8Array
	cipherSuite?: number
	tlsVersion?: string
}

// ===== SYNTHETIC CLAIM REQUEST STRUCTURES =====

export interface SyntheticTranscriptMessage {
	sender: 'client' | 'server'
	message: Uint8Array
	reveal?: {
		directReveal?: {
			key: Uint8Array
			iv: Uint8Array
			recordNumber: number
		}
		zkReveal?: any // ZK reveal not used in TEE mode
	}
}

// ===== ERROR AND VALIDATION STRUCTURES =====

export interface TeeValidationError extends Error {
	code: 'INVALID_TEE_BUNDLE' | 'INVALID_ATTESTATION' | 'INVALID_SIGNATURE' | 'TRANSCRIPT_RECONSTRUCTION_FAILED'
	details?: any
}

export interface TeeSignatureVerificationResult {
	isValid: boolean
	errors: string[]
	publicKey?: Uint8Array
}

// ===== CONFIGURATION =====

export interface TeeConfig {
	expectedPcrs?: { [key: number]: Buffer }
	maxAttestationAgeHours?: number
	awsNitroRootCert?: string
}

// ===== UTILITY TYPES =====

export type TeeType = 'tee_k' | 'tee_t'

export interface PublicKeyExtractionResult {
	publicKey: Uint8Array
	teeType: TeeType
	ethAddress?: string // ETH address with 0x prefix (new format)
}
