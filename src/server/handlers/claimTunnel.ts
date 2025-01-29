import { MAX_CLAIM_TIMESTAMP_DIFF_S } from 'src/config'
import { ClaimTunnelResponse } from 'src/proto/api'
import { getApm } from 'src/server/utils/apm'
import { assertTranscriptsMatch, assertValidClaimRequest } from 'src/server/utils/assert-valid-claim-request'
import { getAttestorAddress, signAsAttestor } from 'src/server/utils/generics'
import { RPCHandler } from 'src/types'
import { AttestorError, createSignDataForClaim, getIdentifierFromClaimInfo, unixTimestampSeconds } from 'src/utils'

export const claimTunnel: RPCHandler<'claimTunnel'> = async(
	claimRequest,
	{ tx, logger, client }
) => {
	const {
		request,
		data: { timestampS } = {},
	} = claimRequest
	const tunnel = client.getTunnel(request?.id!)
	try {
		await tunnel.close()
	} catch(err) {
		logger.debug({ err }, 'error closing tunnel')
	}

	if(tx) {
		const transcriptBytes = tunnel.transcript.reduce(
			(acc, { message }) => acc + message.length,
			0
		)
		tx?.setLabel('transcriptBytes', transcriptBytes.toString())
	}

	// we throw an error for cases where the attestor cannot prove
	// the user's request is faulty. For eg. if the user sends a
	// "createRequest" that does not match the tunnel's actual
	// create request -- the attestor cannot prove that the user
	// is lying. In such cases, we throw a bad request error.
	// Same goes for matching the transcript.
	if(
		tunnel.createRequest?.host !== request?.host
		|| tunnel.createRequest?.port !== request?.port
		|| tunnel.createRequest?.geoLocation !== request?.geoLocation
	) {
		throw AttestorError.badRequest('Tunnel request does not match')
	}

	assertTranscriptsMatch(claimRequest.transcript, tunnel.transcript)

	const res = ClaimTunnelResponse.create({ request: claimRequest })
	try {
		const now = unixTimestampSeconds()
		if(Math.floor(timestampS! - now) > MAX_CLAIM_TIMESTAMP_DIFF_S) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`Timestamp provided ${timestampS} is too far off. Current time is ${now}`
			)
		}

		const assertTx = getApm()
			?.startTransaction('assertValidClaimRequest', { childOf: tx })

		try {
			const claim = await assertValidClaimRequest(
				claimRequest,
				client.metadata,
				logger
			)
			res.claim = {
				...claim,
				identifier: getIdentifierFromClaimInfo(claim),
				// hardcode for compatibility with V1 claims
				epoch: 1
			}
		} catch(err) {
			assertTx?.setOutcome('failure')
			throw err
		} finally {
			assertTx?.end()
		}
	} catch(err) {
		logger.error({ err }, 'invalid claim request')
		const attestorErr = AttestorError.fromError(err)
		attestorErr.code = 'ERROR_INVALID_CLAIM'
		res.error = attestorErr.toProto()
	}

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
			ClaimTunnelResponse.encode(res).finish(),
			client.metadata.signatureType
		)
	}

	// remove tunnel from client -- to free up our mem
	client.removeTunnel(request.id)

	return res
}