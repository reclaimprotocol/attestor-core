import { SIGNATURES } from '../../signatures'
import { RPCHandler } from '../../types'
import { WitnessError } from '../../utils'

export const init: RPCHandler<'init'> = async(
	initRequest,
	{ client }
) => {
	if(client.isInitialised) {
		throw WitnessError.badRequest('Client already initialised')
	}

	if(!SIGNATURES[initRequest.signatureType]) {
		throw WitnessError.badRequest('Unsupported signature type')
	}

	if(initRequest.clientVersion <= 0) {
		throw WitnessError.badRequest('Unsupported client version')
	}

	client.metadata = initRequest
	client.isInitialised = true

	return {}
}