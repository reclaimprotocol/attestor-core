/**
 * TEE Bundle Claim Handler
 * Handles ClaimTeeBundleRequest by verifying TEE attestations and reconstructing TLS transcript
 */

import { ClaimTeeBundleResponse, ProviderClaimInfo } from 'src/proto/api'
import { CertificateInfo } from 'src/proto/tee-bundle'
import { getApm } from 'src/server/utils/apm'
import { assertValidProviderTranscript } from 'src/server/utils/assert-valid-claim-request'
import { getAttestorAddress, niceParseJsonObject, signAsAttestor } from 'src/server/utils/generics'
import { reconstructTlsTranscript, TeeTranscriptData } from 'src/server/utils/tee-transcript-reconstruction'
import { verifyTeeBundle } from 'src/server/utils/tee-verification'
import { Logger, ProviderCtx, RPCHandler, Transcript } from 'src/types'
import { AttestorError, createSignDataForClaim, getIdentifierFromClaimInfo } from 'src/utils'

export const claimTeeBundle: RPCHandler<'claimTeeBundle'> = async(
	teeBundleRequest,
	{ tx, logger, client }
) => {
	const {
		verificationBundle,
		data
	} = teeBundleRequest

	// Initialize response
	const res = ClaimTeeBundleResponse.create({ request: teeBundleRequest })

	try {
		// 1. Verify TEE bundle (attestations + signatures) - this includes timestamp validation
		logger.info('Starting TEE bundle verification')
		const teeData = await verifyTeeBundle(verificationBundle, logger)

		// 2. Extract timestampS from TEE_K bundle for claim signing
		const timestampS = Math.floor(teeData.kOutputPayload.timestampMs / 1000)

		// 3. Reconstruct TLS transcript from TEE data
		logger.info('Starting TLS transcript reconstruction')
		const transcriptData = await reconstructTlsTranscript(teeData, logger)

		// 4. Create plaintext transcript for provider validation
		logger.info('Creating plaintext transcript from TEE data')
		const plaintextTranscript = createPlaintextTranscriptFromTeeData(transcriptData, logger)

		// 5. Direct provider validation (bypass signature validation completely)
		logger.info('Running direct provider validation on TEE reconstructed data')
		const validateTx = getApm()
			?.startTransaction('validateTeeProviderReceipt', { childOf: tx })

		try {
			if(!data) {
				throw new AttestorError('ERROR_INVALID_CLAIM', 'No claim data provided in TEE bundle request')
			}

			const validatedClaim = await validateTeeProviderReceipt(
				plaintextTranscript,
				data,
				logger,
				{ version: client.metadata.clientVersion },
				transcriptData.certificateInfo
			)

			res.claim = {
				...validatedClaim,
				identifier: getIdentifierFromClaimInfo(validatedClaim),
				// Use timestampS from TEE_K bundle for claim signing
				timestampS,
				// hardcode for compatibility with V1 claims
				epoch: 1
			}

			logger.info({ claim: res.claim }, 'TEE bundle claim validation successful')

		} catch(err) {
			validateTx?.setOutcome('failure')
			throw err
		} finally {
			validateTx?.end()
		}

	} catch(err) {
		logger.error({ err }, 'Invalid TEE bundle claim request')
		const attestorErr = AttestorError.fromError(err)
		attestorErr.code = 'ERROR_INVALID_CLAIM'
		res.error = attestorErr.toProto()
	}

	// 7. Sign the response
	res.signatures = {
		attestorAddress: getAttestorAddress(
			client.metadata.signatureType
		),
		claimSignature: res.claim
			? await signAsAttestor(
				createSignDataForClaim(res.claim),
				client.metadata.signatureType
			)
			: new Uint8Array(),
		resultSignature: await signAsAttestor(
			ClaimTeeBundleResponse.encode(res).finish(),
			client.metadata.signatureType
		)
	}

	logger.info('TEE bundle claim processing completed')
	return res
}

/**
 * Creates a plaintext transcript from TEE reconstructed data
 * This converts the TEE transcript data into the format expected by provider validation
 * NEW: Uses consolidated response instead of individual packets for simplicity
 */
function createPlaintextTranscriptFromTeeData(
	transcriptData: TeeTranscriptData,
	logger: Logger
): Transcript<Uint8Array> {
	const transcript: Array<{ sender: 'client' | 'server', message: Uint8Array }> = []

	// Add reconstructed request (client -> server)
	if(transcriptData.revealedRequest && transcriptData.revealedRequest.length > 0) {
		transcript.push({
			sender: 'client',
			message: transcriptData.revealedRequest
		})
		logger.debug('Added TEE revealed request to plaintext transcript', {
			length: transcriptData.revealedRequest.length
		})
	}

	// Add consolidated reconstructed response (server -> client)
	if(transcriptData.reconstructedResponse && transcriptData.reconstructedResponse.length > 0) {
		transcript.push({
			sender: 'server',
			message: transcriptData.reconstructedResponse
		})
		logger.debug('Added TEE consolidated response to plaintext transcript', {
			length: transcriptData.reconstructedResponse.length
		})
	}

	// Log certificate validation info if available
	if(transcriptData.certificateInfo) {
		logger.info('Certificate information available for validation', {
			commonName: transcriptData.certificateInfo.commonName,
			issuerCommonName: transcriptData.certificateInfo.issuerCommonName,
			dnsNames: transcriptData.certificateInfo.dnsNames,
			notBefore: new Date(transcriptData.certificateInfo.notBeforeUnix * 1000).toISOString(),
			notAfter: new Date(transcriptData.certificateInfo.notAfterUnix * 1000).toISOString()
		})
	}

	logger.info('Created plaintext transcript from TEE data', {
		totalMessages: transcript.length,
		hasRequest: !!transcriptData.revealedRequest?.length,
		hasResponse: !!transcriptData.reconstructedResponse?.length,
		hasCertificateInfo: !!transcriptData.certificateInfo
	})

	return transcript
}

/**
 * Validates TEE provider receipt directly without signature validation
 * This is essentially assertValidProviderTranscript but for TEE data
 * NEW: Includes certificate validation for domain authentication
 */
async function validateTeeProviderReceipt<T extends ProviderClaimInfo>(
	plaintextTranscript: Transcript<Uint8Array>,
	claimInfo: T,
	logger: Logger,
	providerCtx: ProviderCtx,
	certificateInfo?: CertificateInfo
): Promise<T> {
	logger.info('Starting direct TEE provider validation', {
		provider: claimInfo.provider,
		transcriptMessages: plaintextTranscript.length,
		hasCertificateInfo: !!certificateInfo
	})

	// NEW: Validate certificate if available
	if(certificateInfo) {
		validateTlsCertificate(claimInfo, certificateInfo, logger)
	}

	// Use the existing provider validation logic directly
	const validatedClaim = await assertValidProviderTranscript(
		plaintextTranscript,
		claimInfo,
		logger,
		providerCtx
	)

	logger.info('TEE provider validation completed successfully', {
		provider: validatedClaim.provider,
		owner: (validatedClaim as any).owner || 'unknown'
	})

	return validatedClaim
}

/**
 * NEW: Validates that the TLS certificate is valid for the domain being claimed
 * This prevents domain substitution attacks in TEE+MPC scenarios
 */
function validateTlsCertificate(
	claimInfo: ProviderClaimInfo,
	certificateInfo: CertificateInfo,
	logger: Logger
): void {
	// Extract hostname from the claim (this varies by provider)
	let claimedHostname: string | undefined

	const params = niceParseJsonObject(claimInfo.parameters, 'params')

	// Different providers store hostname in different places
	if('url' in params && typeof params.url === 'string') {
		claimedHostname = new URL(params.url).hostname
	}

	if(!claimedHostname) {
		logger.warn('Could not extract hostname from claim for certificate validation', {
			provider: claimInfo.provider
		})
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'Certificate validation failed: hostname not found'
		)
	}

	logger.info('Validating TLS certificate for claimed hostname', {
		claimedHostname,
		certificateCommonName: certificateInfo.commonName,
		certificateDnsNames: certificateInfo.dnsNames
	})

	// Check if claimed hostname matches certificate
	const isValidForHostname =
		certificateInfo.commonName === claimedHostname ||
		certificateInfo.dnsNames.includes(claimedHostname)

	if(!isValidForHostname) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			`Certificate validation failed: hostname '${claimedHostname}' not valid for certificate (CN: ${certificateInfo.commonName}, SANs: ${certificateInfo.dnsNames.join(', ')})`
		)
	}

	// Check certificate validity period
	const now = Date.now() / 1000 // Current time in Unix seconds
	if(now < certificateInfo.notBeforeUnix || now > certificateInfo.notAfterUnix) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			`Certificate validation failed: certificate not valid at current time (valid from ${new Date(certificateInfo.notBeforeUnix * 1000).toISOString()} to ${new Date(certificateInfo.notAfterUnix * 1000).toISOString()})`
		)
	}

	logger.info('TLS certificate validation passed', {
		claimedHostname,
		validatedAgainst: isValidForHostname ? (certificateInfo.commonName === claimedHostname ? 'CommonName' : 'SAN') : 'none'
	})
}


