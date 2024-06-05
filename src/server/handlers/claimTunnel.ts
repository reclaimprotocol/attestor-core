import { MAX_CLAIM_TIMESTAMP_DIFF_S } from '../../config'
import { ClaimTunnelResponse } from '../../proto/api'
import { RPCHandler } from '../../types'
import { createSignDataForClaim, getIdentifierFromClaimInfo, unixTimestampSeconds, WitnessError } from '../../utils'
import { assertTranscriptsMatch, assertValidClaimRequest } from '../utils/assert-valid-claim-request'
import { getWitnessAddress, signAsWitness } from '../utils/generics'

export const claimTunnel: RPCHandler<'claimTunnel'> = async(
	claimRequest,
	{ logger, client }
) => {
	const {
		request,
		data: { timestampS } = {},
	} = claimRequest
	const tunnel = client.getTunnel(request?.id!)
	// we throw an error for cases where the witness cannot prove
	// the user's request is faulty. For eg. if the user sends a
	// "createRequest" that does not match the tunnel's actual
	// create request -- the witness cannot prove that the user
	// is lying. In such cases, we throw a bad request error.
	// Same goes for matching the transcript.
	if(
		tunnel.createRequest?.host !== request?.host
		|| tunnel.createRequest?.port !== request?.port
		|| tunnel.createRequest?.geoLocation !== request?.geoLocation
	) {
		throw WitnessError.badRequest('Tunnel request does not match')
	}

	assertTranscriptsMatch(claimRequest.transcript, tunnel.transcript)

	const res = ClaimTunnelResponse.create({ request: claimRequest })
	try {
		const now = unixTimestampSeconds()
		if(Math.floor(timestampS! - now) > MAX_CLAIM_TIMESTAMP_DIFF_S) {
			throw new WitnessError(
				'WITNESS_ERROR_INVALID_CLAIM',
				`Timestamp provided ${timestampS} is too far off. Current time is ${now}`
			)
		}

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
		logger.error({ err }, 'invalid claim request')
		const witnessErr = WitnessError.fromError(err)
		witnessErr.code = 'WITNESS_ERROR_INVALID_CLAIM'
		res.error = witnessErr.toProto()
	}

	res.signatures = {
		witnessAddress: await getWitnessAddress(
			client.metadata.signatureType
		),
		claimSignature: res.claim
			? await signAsWitness(
				createSignDataForClaim(res.claim),
				client.metadata.signatureType
			)
			: new Uint8Array(),
		resultSignature: await signAsWitness(
			ClaimTunnelResponse.encode(res).finish(),
			client.metadata.signatureType
		)
	}

	return res
}