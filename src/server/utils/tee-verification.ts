/**
 * TEE Bundle verification utilities
 * Handles validation of TEE verification bundles including attestations and signatures
 */

import { ServiceSignatureType } from 'src/proto/api'
import { BodyType, KOutputPayload, SignedMessage, TOutputPayload, VerificationBundle } from 'src/proto/tee-bundle'
import { validateNitroAttestationAndExtractKey } from 'src/server/utils/nitro-attestation'
import { Logger } from 'src/types'
import { AddressExtractionResult, TeeBundleData, TeeSignatureVerificationResult } from 'src/types/tee'
import { AttestorError, uint8ArrayToStr } from 'src/utils'
import { SIGNATURES } from 'src/utils/signatures'

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
	try {
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

		logger.info('TEE bundle verification successful')

		return {
			teekSigned: bundle.teekSigned,
			teetSigned: bundle.teetSigned,
			kOutputPayload,
			tOutputPayload,
			handshakeKeys: bundle.handshakeKeys,
		}

	} catch(error) {
		logger.error({ error }, 'TEE bundle verification failed')
		throw new AttestorError('ERROR_INVALID_CLAIM', `TEE bundle verification failed: ${(error as Error).message}`)
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

	const hasPublicKeys = (bundle.teekSigned.publicKey && bundle.teekSigned.publicKey.length > 0) ||
		(bundle.teetSigned.publicKey && bundle.teetSigned.publicKey.length > 0)

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
		// Production mode: Extract from Nitro attestations
		logger.info('Using production mode: extracting keys from Nitro attestations')

		// Use embedded attestation reports
		logger.info('Using embedded attestation reports')
		if(!bundle.teekSigned?.attestationReport?.report) {
			throw new Error('TEE_K embedded attestation report missing')
		}

		if(!bundle.teetSigned?.attestationReport?.report) {
			throw new Error('TEE_T embedded attestation report missing')
		}

		const teekAttestationBytes = bundle.teekSigned.attestationReport.report
		const teetAttestationBytes = bundle.teetSigned.attestationReport.report

		const teekResult = await validateNitroAttestationAndExtractKey(teekAttestationBytes)
		if(!teekResult.isValid) {
			throw new Error(`TEE_K attestation validation failed: ${teekResult.errors.join(', ')}`)
		}

		if(!teekResult.ethAddress) {
			throw new Error('TEE_K attestation validation failed: no address')
		}

		if(teekResult.userDataType !== 'tee_k') {
			throw new Error(`TEE_K attestation validation failed: wrong TEE type, expected tee_k, got ${teekResult.userDataType}`)
		}

		const teetResult = await validateNitroAttestationAndExtractKey(teetAttestationBytes)
		if(!teetResult.isValid) {
			throw new Error(`TEE_T attestation validation failed: ${teetResult.errors.join(', ')}`)
		}

		if(!teetResult.ethAddress) {
			throw new Error('TEE_T attestation validation failed: no address')
		}

		if(teetResult.userDataType !== 'tee_t') {
			throw new Error(`TEE_T attestation validation failed: wrong TEE type, expected tee_t, got ${teetResult.userDataType}`)
		}

		// Store the full extraction results for signature verification
		teekKeyResult = {
			teeType: 'tee_k',
			ethAddress: teekResult.ethAddress
		}
		teetKeyResult = {
			teeType: 'tee_t',
			ethAddress: teetResult.ethAddress
		}

		logger.info('Nitro attestations validated successfully')

	} else {
		// Standalone mode: Use embedded public keys
		logger.info('Using standalone mode: extracting embedded public keys')

		if(!bundle.teekSigned?.publicKey || bundle.teekSigned.publicKey.length === 0) {
			throw new Error('TEE_K public key missing in standalone mode')
		}

		if(!bundle.teetSigned?.publicKey || bundle.teetSigned.publicKey.length === 0) {
			throw new Error('TEE_T public key missing in standalone mode')
		}

		teekAddress = uint8ArrayToStr(bundle.teekSigned.publicKey)
		teetAddress = uint8ArrayToStr(bundle.teetSigned.publicKey)

		teekKeyResult = { ethAddress: teekAddress, teeType: 'tee_k' }
		teetKeyResult = { ethAddress: teetAddress, teeType: 'tee_t' }

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
	try {
		// Use actual protobuf decoding
		const payload = KOutputPayload.decode(signedMessage.body)

		// Validate required fields
		if(!payload.redactedRequest) {
			throw new Error('Missing redacted request in TEE_K payload')
		}

		if(!payload.packets || payload.packets.length === 0) {
			throw new Error('Missing handshake packets in TEE_K payload')
		}

		return payload

	} catch(error) {
		throw new Error(`Failed to parse TEE_K payload: ${(error as Error).message}`)
	}
}

/**
 * Parses TEE_T output payload
 */
function parseTOutputPayload(signedMessage: SignedMessage): TOutputPayload {
	try {
		// Use actual protobuf decoding
		const payload = TOutputPayload.decode(signedMessage.body)

		// Validate required fields
		if(!payload.packets || payload.packets.length === 0) {
			throw new Error('Missing application data packets in TEE_T payload')
		}

		return payload

	} catch(error) {
		throw new Error(`Failed to parse TEE_T payload: ${(error as Error).message}`)
	}
}
