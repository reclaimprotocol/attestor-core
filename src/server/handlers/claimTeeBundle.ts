/**
 * TEE Bundle Claim Handler
 * Handles ClaimTeeBundleRequest by verifying TEE attestations and reconstructing TLS transcript
 */

import { MAX_CLAIM_TIMESTAMP_DIFF_S } from 'src/config'
import { ClaimTeeBundleResponse, ProviderClaimInfo } from 'src/proto/api'
import { getApm } from 'src/server/utils/apm'
import { assertValidProviderTranscript } from 'src/server/utils/assert-valid-claim-request'
import { getAttestorAddress, signAsAttestor } from 'src/server/utils/generics'
import { reconstructTlsTranscript } from 'src/server/utils/tee-transcript-reconstruction'
import { verifyTeeBundle } from 'src/server/utils/tee-verification'
import { Logger, ProviderCtx, RPCHandler, Transcript } from 'src/types'
import { TeeTranscriptData } from 'src/types/tee'
import { AttestorError, createSignDataForClaim, getIdentifierFromClaimInfo, unixTimestampSeconds } from 'src/utils'

export const claimTeeBundle: RPCHandler<'claimTeeBundle'> = async(
	teeBundleRequest,
	{ tx, logger, client }
) => {
	const {
		verificationBundle,
		data: { timestampS } = {}
	} = teeBundleRequest

	// Initialize response
	const res = ClaimTeeBundleResponse.create({ request: teeBundleRequest })

	try {
		// 1. Validate timestamp
		const now = unixTimestampSeconds()
		if(Math.floor(timestampS! - now) > MAX_CLAIM_TIMESTAMP_DIFF_S) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`Timestamp provided ${timestampS} is too far off. Current time is ${now}`
			)
		}

		// 3. Verify TEE bundle (attestations + signatures)
		logger.info('Starting TEE bundle verification')
		const teeData = await verifyTeeBundle(verificationBundle, logger)

		// 4. Reconstruct TLS transcript from TEE data
		logger.info('Starting TLS transcript reconstruction')
		const transcriptData = await reconstructTlsTranscript(teeData, logger)

		// 5. Create plaintext transcript for provider validation
		logger.info('Creating plaintext transcript from TEE data')
		const plaintextTranscript = createPlaintextTranscriptFromTeeData(transcriptData, logger)

		// 6. Direct provider validation (bypass signature validation completely)
		logger.info('Running direct provider validation on TEE reconstructed data')
		const validateTx = getApm()
			?.startTransaction('validateTeeProviderReceipt', { childOf: tx })

		try {
			if(!teeBundleRequest.data) {
				throw new AttestorError('ERROR_INVALID_CLAIM', 'No claim data provided in TEE bundle request')
			}

			const validatedClaim = await validateTeeProviderReceipt(
				plaintextTranscript,
				teeBundleRequest.data,
				logger,
				{ version: client.metadata.clientVersion }
			)

			res.claim = {
				...validatedClaim,
				identifier: getIdentifierFromClaimInfo(validatedClaim),
				// hardcode for compatibility with V1 claims
				epoch: 1
			}

			logger.info({ claimId: res.claim.identifier }, 'TEE bundle claim validation successful')

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
 * Maintains individual packet boundaries like the original transcript structure
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

	// Add reconstructed response packets (server -> client)
	// Use individual packets to preserve packet boundaries
	if(transcriptData.reconstructedResponsePackets && transcriptData.reconstructedResponsePackets.length > 0) {
		// Use the new individual response packets
		for(const packet of transcriptData.reconstructedResponsePackets) {
			transcript.push({
				sender: 'server',
				message: packet
			})
		}

		logger.debug('Added TEE individual response packets to plaintext transcript', {
			packetCount: transcriptData.reconstructedResponsePackets.length,
			totalLength: transcriptData.reconstructedResponsePackets.reduce((sum, pkt) => sum + pkt.length, 0)
		})
	}

	logger.info('Created plaintext transcript from TEE data', {
		totalMessages: transcript.length,
		hasRequest: !!transcriptData.revealedRequest?.length,
		hasResponse: !!transcriptData.reconstructedResponsePackets?.length
	})

	return transcript
}

/**
 * Validates TEE provider receipt directly without signature validation
 * This is essentially assertValidProviderTranscript but for TEE data
 */
async function validateTeeProviderReceipt<T extends ProviderClaimInfo>(
	plaintextTranscript: Transcript<Uint8Array>,
	claimInfo: T,
	logger: Logger,
	providerCtx: ProviderCtx
): Promise<T> {
	logger.info('Starting direct TEE provider validation', {
		provider: claimInfo.provider,
		transcriptMessages: plaintextTranscript.length
	})

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


