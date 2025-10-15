/**
 * TEE Bundle verification utilities
 * Handles validation of TEE verification bundles including attestations and signatures
 */

import { ServiceSignatureType } from '#src/proto/api.ts'
import type { SignedMessage } from '#src/proto/tee-bundle.ts'
import { BodyType, KOutputPayload, TOutputPayload, VerificationBundle } from '#src/proto/tee-bundle.ts'
import { validateGcpAttestationAndExtractKey } from '#src/server/utils/gcp-attestation.ts'
import type { AddressExtractionResult } from '#src/server/utils/nitro-attestation.ts'
import { validateNitroAttestationAndExtractKey } from '#src/server/utils/nitro-attestation.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'
import { uint8ArrayToStr } from '#src/utils/index.ts'
import { SIGNATURES } from '#src/utils/signatures/index.ts'

// Types specific to TEE verification
export interface TeeBundleData {
	teekSigned: SignedMessage
	teetSigned: SignedMessage
	kOutputPayload: KOutputPayload
	tOutputPayload: TOutputPayload
	teekPcr0: string
	teetPcr0: string
}

export interface TeeSignatureVerificationResult {
	isValid: boolean
	errors: string[]
	address?: string
}

/**
 * Verifies a complete TEE verification bundle
 * @param bundleBytes - Raw protobuf-encoded verification bundle
 * @param logger - Logger instance
 * @returns Validated TEE bundle data
 */
export async function verifyTeeBundle(
	bundleBytes: Uint8Array,
	logger: Logger
): Promise<TeeBundleData> {
	// Parse the verification bundle protobuf
	const bundle = parseVerificationBundle(bundleBytes)

	// Validate required components are present
	validateBundleCompleteness(bundle)

	// Extract public keys (from attestations or embedded keys)
	const { teekKeyResult, teetKeyResult } = await extractPublicKeys(bundle, logger)

	// Verify TEE signatures using extracted public keys
	await verifyTeeSignatures(bundle, teekKeyResult!, teetKeyResult!, logger)

	// Ensure signed messages are present
	if(!bundle.teekSigned || !bundle.teetSigned) {
		throw new AttestorError('ERROR_INVALID_CLAIM', 'Missing TEE signed messages')
	}

	// Parse TEE payloads
	const kOutputPayload = parseKOutputPayload(bundle.teekSigned)
	const tOutputPayload = parseTOutputPayload(bundle.teetSigned)

	// Validate timestamps
	validateTimestamps(kOutputPayload, tOutputPayload, logger)

	logger.info('TEE bundle verification successful')

	return {
		teekSigned: bundle.teekSigned,
		teetSigned: bundle.teetSigned,
		kOutputPayload,
		tOutputPayload,
		teekPcr0: teekKeyResult!.pcr0,
		teetPcr0: teetKeyResult!.pcr0,
	}
}

/**
 * Parses the raw verification bundle bytes into structured data
 */
function parseVerificationBundle(bundleBytes: Uint8Array): VerificationBundle {
	try {
		// Use the actual protobuf decoder for the TEE bundle format
		return VerificationBundle.decode(bundleBytes)

	} catch(error) {
		throw new Error(`Failed to parse verification bundle: ${(error as Error).message}`)
	}
}

/**
 * Validates that all required bundle components are present
 */
function validateBundleCompleteness(bundle: VerificationBundle): void {
	if(!bundle.teekSigned) {
		throw new Error('SECURITY ERROR: missing TEE_K signed message - verification bundle incomplete')
	}

	if(!bundle.teetSigned) {
		throw new Error('SECURITY ERROR: missing TEE_T signed message - verification bundle incomplete')
	}

	// Check if we're in standalone mode (development/testing) or attestation mode (production)
	// Attestations are now embedded in SignedMessage.attestationReport
	const hasAttestations = (bundle.teekSigned.attestationReport?.report && bundle.teekSigned.attestationReport.report.length > 0) ||
		(bundle.teetSigned.attestationReport?.report && bundle.teetSigned.attestationReport.report.length > 0)

	const hasPublicKeys = (bundle.teekSigned.ethAddress && bundle.teekSigned.ethAddress.length > 0) ||
		(bundle.teetSigned.ethAddress && bundle.teetSigned.ethAddress.length > 0)

	if(!hasAttestations && !hasPublicKeys) {
		throw new Error('SECURITY ERROR: bundle must have either Nitro attestations (production) or embedded public keys (development)')
	}

	// Validate signed message structure
	if(bundle.teekSigned.bodyType !== BodyType.BODY_TYPE_K_OUTPUT) {
		throw new Error('Invalid TEE_K signed message: wrong body type')
	}

	if(bundle.teetSigned.bodyType !== BodyType.BODY_TYPE_T_OUTPUT) {
		throw new Error('Invalid TEE_T signed message: wrong body type')
	}

	if(!bundle.teekSigned.body || bundle.teekSigned.body.length === 0) {
		throw new Error('Invalid TEE_K signed message: empty body')
	}

	if(!bundle.teetSigned.body || bundle.teetSigned.body.length === 0) {
		throw new Error('Invalid TEE_T signed message: empty body')
	}

	if(!bundle.teekSigned.signature || bundle.teekSigned.signature.length === 0) {
		throw new Error('Invalid TEE_K signed message: missing signature')
	}

	if(!bundle.teetSigned.signature || bundle.teetSigned.signature.length === 0) {
		throw new Error('Invalid TEE_T signed message: missing signature')
	}
}

/**
 * Extracts public keys from either Nitro attestations or embedded keys (standalone mode)
 */
async function extractPublicKeys(
	bundle: VerificationBundle,
	logger: Logger
): Promise<{
	teekKeyResult?: AddressExtractionResult
	teetKeyResult?: AddressExtractionResult
}> {
	// Check if we have attestations (production mode) or embedded keys (standalone mode)
	// Attestations are now embedded in SignedMessage.attestationReport
	const hasEmbeddedAttestations = (bundle.teekSigned!.attestationReport?.report && bundle.teekSigned!.attestationReport.report.length > 0) &&
		(bundle.teetSigned!.attestationReport?.report && bundle.teetSigned!.attestationReport.report.length > 0)

	let teekAddress: string | undefined
	let teetAddress: string | undefined
	let teekKeyResult: AddressExtractionResult | undefined
	let teetKeyResult: AddressExtractionResult | undefined

	if(hasEmbeddedAttestations) {
		// Production mode: Extract from attestations (Nitro or GCP)
		logger.info('Using production mode: extracting keys from attestations')

		if(!bundle.teekSigned?.attestationReport?.report) {
			throw new Error('TEE_K embedded attestation report missing')
		}

		if(!bundle.teetSigned?.attestationReport?.report) {
			throw new Error('TEE_T embedded attestation report missing')
		}

		const teekAttestationType = bundle.teekSigned.attestationReport.type || 'nitro'
		const teetAttestationType = bundle.teetSigned.attestationReport.type || 'nitro'

		logger.info(`TEE_K attestation type: ${teekAttestationType}`)
		logger.info(`TEE_T attestation type: ${teetAttestationType}`)

		const teekAttestationBytes = bundle.teekSigned.attestationReport.report
		const teetAttestationBytes = bundle.teetSigned.attestationReport.report

		// Validate TEE_K attestation based on type
		if(teekAttestationType === 'gcp') {
			const gcpResult = await validateGcpAttestationAndExtractKey(teekAttestationBytes, logger)

			if(!gcpResult.isValid) {
				throw new Error(`TEE_K GCP attestation validation failed: ${gcpResult.errors.join(', ')}`)
			}

			if(!gcpResult.ethAddress) {
				throw new Error('TEE_K GCP attestation validation failed: no address')
			}

			if(gcpResult.userDataType !== 'tee_k') {
				throw new Error(`TEE_K GCP attestation validation failed: wrong TEE type, expected tee_k, got ${gcpResult.userDataType}`)
			}

			teekKeyResult = {
				teeType: gcpResult.userDataType as 'tee_k' | 'tee_t',
				ethAddress: '0x' + Buffer.from(gcpResult.ethAddress).toString('hex'),
				pcr0: gcpResult.pcr0 || 'gcp-no-digest'
			}
		} else {
			const nitroResult = await validateNitroAttestationAndExtractKey(teekAttestationBytes)

			if(!nitroResult.isValid) {
				throw new Error(`TEE_K Nitro attestation validation failed: ${nitroResult.errors.join(', ')}`)
			}

			if(!nitroResult.ethAddress) {
				throw new Error('TEE_K Nitro attestation validation failed: no address')
			}

			if(nitroResult.userDataType !== 'tee_k') {
				throw new Error(`TEE_K Nitro attestation validation failed: wrong TEE type, expected tee_k, got ${nitroResult.userDataType}`)
			}

			teekKeyResult = {
				teeType: nitroResult.userDataType,
				ethAddress: nitroResult.ethAddress,
				pcr0: nitroResult.pcr0
			}
		}

		// Validate TEE_T attestation based on type
		if(teetAttestationType === 'gcp') {
			const gcpResult = await validateGcpAttestationAndExtractKey(teetAttestationBytes, logger)

			if(!gcpResult.isValid) {
				throw new Error(`TEE_T GCP attestation validation failed: ${gcpResult.errors.join(', ')}`)
			}

			if(!gcpResult.ethAddress) {
				throw new Error('TEE_T GCP attestation validation failed: no address')
			}

			if(gcpResult.userDataType !== 'tee_t') {
				throw new Error(`TEE_T GCP attestation validation failed: wrong TEE type, expected tee_t, got ${gcpResult.userDataType}`)
			}

			teetKeyResult = {
				teeType: gcpResult.userDataType as 'tee_k' | 'tee_t',
				ethAddress: '0x' + Buffer.from(gcpResult.ethAddress).toString('hex'),
				pcr0: gcpResult.pcr0 || 'gcp-no-digest'
			}

			// Cross-validate: TEE_T must have EXPECTED_TEEK_PCR0 env var matching TEE_K's PCR0
			if(!gcpResult.envVars?.EXPECTED_TEEK_PCR0) {
				throw new Error('TEE_T GCP attestation missing required EXPECTED_TEEK_PCR0 environment variable')
			}

			const expectedPcr0 = gcpResult.envVars.EXPECTED_TEEK_PCR0
			const actualPcr0 = teekKeyResult.pcr0

			logger.info(`Cross-validating TEE_K PCR0: expected=${expectedPcr0}, actual=${actualPcr0}`)

			if(expectedPcr0 !== actualPcr0) {
				throw new Error(`TEE cross-validation failed: TEE_T expects TEE_K PCR0 "${expectedPcr0}" but got "${actualPcr0}"`)
			}

			logger.info('TEE cross-validation successful: TEE_K PCR0 matches TEE_T expectation')
		} else {
			const nitroResult = await validateNitroAttestationAndExtractKey(teetAttestationBytes)

			if(!nitroResult.isValid) {
				throw new Error(`TEE_T Nitro attestation validation failed: ${nitroResult.errors.join(', ')}`)
			}

			if(!nitroResult.ethAddress) {
				throw new Error('TEE_T Nitro attestation validation failed: no address')
			}

			if(nitroResult.userDataType !== 'tee_t') {
				throw new Error(`TEE_T Nitro attestation validation failed: wrong TEE type, expected tee_t, got ${nitroResult.userDataType}`)
			}

			teetKeyResult = {
				teeType: nitroResult.userDataType,
				ethAddress: nitroResult.ethAddress,
				pcr0: nitroResult.pcr0
			}
		}

		logger.info('Attestations validated successfully')

	} else {
		// Standalone mode: Use embedded public keys
		logger.info('Using standalone mode: extracting embedded public keys')

		if(!bundle.teekSigned?.ethAddress || bundle.teekSigned.ethAddress.length === 0) {
			throw new Error('TEE_K eth address missing in standalone mode')
		}

		if(!bundle.teetSigned?.ethAddress || bundle.teetSigned.ethAddress.length === 0) {
			throw new Error('TEE_T eth address missing in standalone mode')
		}

		teekAddress = uint8ArrayToStr(bundle.teekSigned.ethAddress)
		teetAddress = uint8ArrayToStr(bundle.teetSigned.ethAddress)

		teekKeyResult = { ethAddress: teekAddress, teeType: 'tee_k', pcr0: 'standalone_k' }
		teetKeyResult = { ethAddress: teetAddress, teeType: 'tee_t', pcr0: 'standalone_t' }

		logger.info('Embedded public keys extracted successfully')
	}

	return {
		teekKeyResult,
		teetKeyResult
	}
}

/**
 * Verifies TEE signatures using extracted key results
 */
async function verifyTeeSignatures(
	bundle: VerificationBundle,
	teekKeyResult: AddressExtractionResult,
	teetKeyResult: AddressExtractionResult,
	logger: Logger
): Promise<void> {
	// Verify TEE_K signature
	if(!bundle.teekSigned) {
		throw new Error('TEE_K signed message is missing')
	}

	const teekResult = await verifyTeeSignature(
		bundle.teekSigned,
		teekKeyResult,
		'TEE_K',
		logger
	)

	if(!teekResult.isValid) {
		throw new Error(`TEE_K signature verification failed: ${teekResult.errors.join(', ')}`)
	}

	// Verify TEE_T signature
	if(!bundle.teetSigned) {
		throw new Error('TEE_T signed message is missing')
	}

	const teetResult = await verifyTeeSignature(
		bundle.teetSigned,
		teetKeyResult,
		'TEE_T',
		logger
	)

	if(!teetResult.isValid) {
		throw new Error(`TEE_T signature verification failed: ${teetResult.errors.join(', ')}`)
	}

	logger.info('TEE signatures verified successfully')
}

/**
 * Verifies a single TEE signature using ETH address format
 */
async function verifyTeeSignature(
	signedMessage: SignedMessage,
	extractedKey: AddressExtractionResult,
	teeType: string,
	logger: Logger
): Promise<TeeSignatureVerificationResult> {
	const errors: string[] = []

	if(!signedMessage) {
		return {
			isValid: false,
			errors: ['Signed message is null or undefined']
		}
	}

	try {
		let ethAddress: string

		if(extractedKey.ethAddress) {
			ethAddress = extractedKey.ethAddress
			logger.debug(`${teeType} using ETH address from attestation: ${ethAddress}`)
		} else {
			return {
				isValid: false,
				errors: ['eth address is null'],
			}
		}

		// Use the ETH signature verification from the existing system
		const { verify: verifySig } = SIGNATURES[ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH]

		// Verify signature over the body bytes
		const isValid = await verifySig(
			signedMessage.body,
			signedMessage.signature,
			ethAddress
		)

		if(!isValid) {
			errors.push(`${teeType} signature verification failed for address ${ethAddress}`)
		}

		logger.debug(`${teeType} signature verification result: ${isValid} for address ${ethAddress}`)

		return {
			isValid: errors.length === 0,
			errors,
			address: extractedKey.ethAddress
		}

	} catch(error) {
		errors.push(`${teeType} signature verification error: ${(error as Error).message}`)
		return {
			isValid: false,
			errors
		}
	}
}

/**
 * Parses TEE_K output payload
 */
function parseKOutputPayload(signedMessage: SignedMessage): KOutputPayload {
	// Use actual protobuf decoding
	const payload = KOutputPayload.decode(signedMessage.body)

	// Validate required fields
	if(!payload.redactedRequest) {
		throw new Error('Missing redacted request in TEE_K payload')
	}

	if(!payload.consolidatedResponseKeystream || payload.consolidatedResponseKeystream.length === 0) {
		throw new Error('Missing consolidated response keystream in TEE_K payload')
	}

	if(!payload.certificateInfo) {
		throw new Error('Missing certificate info in TEE_K payload')
	}

	return payload

}

/**
 * Parses TEE_T output payload
 */
function parseTOutputPayload(signedMessage: SignedMessage): TOutputPayload {
	// Use actual protobuf decoding
	const payload = TOutputPayload.decode(signedMessage.body)

	// Validate required fields
	if(!payload.consolidatedResponseCiphertext || payload.consolidatedResponseCiphertext.length === 0) {
		throw new Error('Missing consolidated response ciphertext in TEE_T payload')
	}


	return payload
}

/**
 * Validates that both K and T timestamps are within acceptable range
 * @param kPayload - K output payload with timestamp
 * @param tPayload - T output payload with timestamp
 * @param logger - Logger instance
 */
function validateTimestamps(
	kPayload: KOutputPayload,
	tPayload: TOutputPayload,
	logger: Logger
): void {
	const now = Date.now() // Current time in milliseconds
	const kTimestamp = kPayload.timestampMs
	const tTimestamp = tPayload.timestampMs

	// Convert to seconds for logging consistency with existing code
	const kTimestampS = Math.floor(kTimestamp / 1000)
	const tTimestampS = Math.floor(tTimestamp / 1000)
	const nowS = Math.floor(now / 1000)

	logger.info('Validating TEE timestamps', {
		kTimestampMs: kTimestamp,
		tTimestampMs: tTimestamp,
		kTimestampS,
		tTimestampS,
		nowS
	})

	// 1. Check that both timestamps are not earlier than 10 minutes in the past
	const maxAgeMs = 10 * 60 * 1000 // 10 minutes in milliseconds
	const oldestAllowed = now - maxAgeMs

	if(kTimestamp < oldestAllowed) {
		throw new Error(`TEE_K timestamp ${kTimestamp} is too old. Must be within 10 minutes of current time ${now}`)
	}

	if(tTimestamp < oldestAllowed) {
		throw new Error(`TEE_T timestamp ${tTimestamp} is too old. Must be within 10 minutes of current time ${now}`)
	}

	// 2. Check that both timestamps are within diff
	const timestampDiffMs = Math.abs(kTimestamp - tTimestamp)
	const maxDiffMs = 20 * 1000

	if(timestampDiffMs > maxDiffMs) {
		throw new Error(`TEE timestamps differ by ${timestampDiffMs}ms, which exceeds maximum allowed difference of ${maxDiffMs}ms`)
	}

	logger.info('TEE timestamp validation successful', {
		timestampDiffMs,
		ageKMs: now - kTimestamp,
		ageTMs: now - tTimestamp
	})
}
