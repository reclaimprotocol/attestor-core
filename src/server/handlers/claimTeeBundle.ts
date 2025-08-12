/**
 * TEE Bundle Claim Handler
 * Handles ClaimTeeBundleRequest by verifying TEE attestations and reconstructing TLS transcript
 */

import { MAX_CLAIM_TIMESTAMP_DIFF_S } from 'src/config'
import { ClaimTeeBundleRequest, ClaimTeeBundleResponse } from 'src/proto/api'
import { getApm } from 'src/server/utils/apm'
import { assertValidClaimRequest } from 'src/server/utils/assert-valid-claim-request'
import { getAttestorAddress, signAsAttestor } from 'src/server/utils/generics'
import { createSyntheticClaimRequest, reconstructTlsTranscript } from 'src/server/utils/tee-transcript-reconstruction'
import { verifyTeeBundle } from 'src/server/utils/tee-verification'
import { RPCHandler } from 'src/types'
import { AttestorError, createSignDataForClaim, getIdentifierFromClaimInfo, unixTimestampSeconds } from 'src/utils'
import { SIGNATURES } from 'src/utils/signatures'

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

		// 2. Verify user signature on the request
		await verifyUserSignature(teeBundleRequest, client.metadata, logger)

		// 3. Verify TEE bundle (attestations + signatures)
		logger.info('Starting TEE bundle verification')
		const teeData = await verifyTeeBundle(verificationBundle, logger)

		// 4. Reconstruct TLS transcript from TEE data
		logger.info('Starting TLS transcript reconstruction')
		const transcriptData = await reconstructTlsTranscript(teeData, logger)

		// 5. Create synthetic ClaimTunnelRequest for existing validation pipeline
		logger.info('Creating synthetic claim request for validation')
		const syntheticRequest = createSyntheticClaimRequest(
			transcriptData,
			teeBundleRequest.data,
			teeData
		)

		// 6. Use existing validation pipeline (REUSE 100% of existing logic!)
		logger.info('Running existing claim validation pipeline')
		const assertTx = getApm()
			?.startTransaction('assertValidClaimRequest', { childOf: tx })

		try {
			const claim = await assertValidClaimRequest(
				syntheticRequest,
				client.metadata,
				logger
			)

			res.claim = {
				...claim,
				identifier: getIdentifierFromClaimInfo(claim),
				// hardcode for compatibility with V1 claims
				epoch: 1
			}

			logger.info({ claimId: res.claim.identifier }, 'TEE bundle claim validation successful')

		} catch(err) {
			assertTx?.setOutcome('failure')
			throw err
		} finally {
			assertTx?.end()
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
 * Verifies the user signature on the TEE bundle request
 */
async function verifyUserSignature(
	request: Parameters<typeof claimTeeBundle>[0],
	metadata: any,
	logger: any
): Promise<void> {
	const {
		data,
		signatures: { requestSignature } = {}
	} = request

	if(!data) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'No info provided on TEE bundle claim request'
		)
	}

	if(!requestSignature?.length) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'No signature provided on TEE bundle claim request'
		)
	}

	// Verify request signature (same logic as claimTunnel)
	const serialisedReq = ClaimTeeBundleRequest
		.encode({ ...request, signatures: undefined })
		.finish()

	const { verify: verifySig } = SIGNATURES[metadata.signatureType]
	const verified = await verifySig(
		serialisedReq,
		requestSignature,
		data.owner
	)

	if(!verified) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'Invalid signature on TEE bundle claim request'
		)
	}

	logger.debug('User signature verification successful')
}


