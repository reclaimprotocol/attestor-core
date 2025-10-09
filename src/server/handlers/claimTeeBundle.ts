/**
 * TEE Bundle Claim Handler
 * Handles ClaimTeeBundleRequest by verifying TEE attestations and reconstructing TLS transcript
 */

import type { ProviderClaimInfo } from '#src/proto/api.ts'
import { ClaimTeeBundleResponse } from '#src/proto/api.ts'
import type { CertificateInfo } from '#src/proto/tee-bundle.ts'
import { VerificationBundle } from '#src/proto/tee-bundle.ts'
import { assertValidProviderTranscript } from '#src/server/utils/assert-valid-claim-request.ts'
import { getAttestorAddress, niceParseJsonObject, signAsAttestor } from '#src/server/utils/generics.ts'
import { verifyOprfProofs } from '#src/server/utils/tee-oprf-verification.ts'
import type { TeeTranscriptData } from '#src/server/utils/tee-transcript-reconstruction.ts'
import { reconstructTlsTranscript } from '#src/server/utils/tee-transcript-reconstruction.ts'
import { verifyTeeBundle } from '#src/server/utils/tee-verification.ts'
import type { Logger } from '#src/types/general.ts'
import type { ProviderCtx, RPCHandler, Transcript } from '#src/types/index.ts'
import { AttestorError } from '#src/utils/error.ts'
import { createSignDataForClaim, getIdentifierFromClaimInfo } from '#src/utils/index.ts'

export const claimTeeBundle: RPCHandler<'claimTeeBundle'> = async(
	teeBundleRequest,
	{ logger, client }
) => {
	const {
		verificationBundle,
		data
	} = teeBundleRequest


	// Initialize response
	const res = ClaimTeeBundleResponse.create({ request: teeBundleRequest })

	// 1. Verify TEE bundle (attestations + signatures) - this includes timestamp validation
	logger.info('Starting TEE bundle verification')
	const teeData = await verifyTeeBundle(verificationBundle, logger)

	// 2. Extract timestampS from TEE_K bundle for claim signing
	const timestampS = Math.floor(teeData.kOutputPayload.timestampMs / 1000)

	// 3. Verify OPRF proofs first (before transcript reconstruction)
	logger.info('Verifying OPRF proofs')
	// Parse the verification bundle to get OPRF verifications
	const bundle = VerificationBundle.decode(verificationBundle)
	const oprfResults = await verifyOprfProofs(
		{ ...teeData, oprfVerifications: bundle.oprfVerifications },
		logger
	)

	// 4. Reconstruct TLS transcript with OPRF replacements applied
	logger.info('Starting TLS transcript reconstruction with OPRF replacements')
	const transcriptData = await reconstructTlsTranscript(teeData, logger, oprfResults)

	// 5. Create plaintext transcript for provider validation (OPRF already applied)
	logger.info('Creating plaintext transcript from TEE data')
	const plaintextTranscript = createPlaintextTranscriptFromTeeData(transcriptData, logger)


	// 6. Direct provider validation
	logger.info('Running direct provider validation on TEE reconstructed data')


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

	const ctx = niceParseJsonObject(validatedClaim.context, 'context')
	// eslint-disable-next-line camelcase
	ctx.pcr0_k = teeData.teekPcr0
	// eslint-disable-next-line camelcase
	ctx.pcr0_t = teeData.teetPcr0
	validatedClaim.context = JSON.stringify(ctx)

	res.claim = {
		...validatedClaim,
		identifier: getIdentifierFromClaimInfo(validatedClaim),
		// Use timestampS from TEE_K bundle for claim signing
		timestampS,
		// hardcode for compatibility with V1 claims
		epoch: 1
	}

	logger.info({ claim: res.claim }, 'TEE bundle claim validation successful')


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
 * Checks if a hostname matches a certificate name (with wildcard support)
 * @param hostname - The hostname to check
 * @param certName - The certificate name
 * @returns true if the hostname is valid for this certificate name
 */
function isHostnameValidForCertificate(hostname: string, certName: string): boolean {
	// Exact match
	if(hostname === certName) {
		return true
	}

	// Wildcard match
	if(certName.startsWith('*.')) {
		// Extract the domain from wildcard
		const wildcardDomain = certName.slice(2)

		// Check if hostname ends with the wildcard domain
		if(hostname.endsWith(wildcardDomain)) {
			// Ensure we're matching a subdomain, not partial domain
			const subdomainPart = hostname.slice(0, -(wildcardDomain.length))

			// Valid if:
			// 1. The subdomain part ends with a dot (proper subdomain boundary)
			// 2. The subdomain part doesn't contain additional dots (single-level wildcard)
			if(subdomainPart.endsWith('.')) {
				const subdomain = subdomainPart.slice(0, -1)
				// Wildcard only matches single level, not multiple subdomains
				return !subdomain.includes('.')
			}
		}
	}

	return false
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

	// Check if claimed hostname matches certificate (including wildcard support)
	const isValidForHostname =
		isHostnameValidForCertificate(claimedHostname, certificateInfo.commonName) ||
		certificateInfo.dnsNames.some(name => isHostnameValidForCertificate(claimedHostname, name))

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
		validatedAgainst: isHostnameValidForCertificate(claimedHostname, certificateInfo.commonName) ?
			`CommonName: ${certificateInfo.commonName}` :
			`SAN: ${certificateInfo.dnsNames.find(name => isHostnameValidForCertificate(claimedHostname, name))}`
	})
}

