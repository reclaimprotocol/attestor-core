import { MAX_CLAIM_TIMESTAMP_DIFF_S } from '../../../config'
import { ClaimTunnelResponse } from '../../../proto/api'
import { getIdentifierFromClaimInfo, stringifyClaimParameters, unixTimestampSeconds, WitnessError } from '../../../utils'
import { RPCHandler } from '../../types'
import { assertTranscriptsMatch, assertValidClaimRequest } from '../utils/assert-valid-claim-request'
import { signAsWitness } from '../utils/generics'

export const claimTunnel: RPCHandler<'claimTunnel'> = async(
	claimRequest,
	{ logger, client }
) => {
	const { request, timestampS } = claimRequest
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
		if(Math.floor(timestampS - now) > MAX_CLAIM_TIMESTAMP_DIFF_S) {
			throw new WitnessError(
				'WITNESS_ERROR_INVALID_CLAIM',
				`Timestamp provided ${timestampS} is too far off. Current time is ${now}`
			)
		}

		const info = await assertValidClaimRequest(claimRequest, client.metadata, logger)
		res.claim = {
			provider: info.provider,
			parameters: info.parameters,
			owner: client.metadata.userId,
			timestampS,
			context: info.context,
			identifier: getIdentifierFromClaimInfo(info),
			// hardcoding epoch for now
			epoch: 1
		}
	} catch(err) {
		logger.error({ err }, 'invalid claim request')
		res.error = WitnessError.fromError(err).toProto()
	}

	res.signatures = {
		claimSignature: res.claim
			? await signAsWitness(
				stringifyClaimParameters(res.claim),
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