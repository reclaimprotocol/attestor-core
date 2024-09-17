import { RPCHandler } from 'src/types'
import { AttestorError } from 'src/utils'
import { SIGNATURES } from 'src/utils/signatures'

export const init: RPCHandler<'init'> = async(
	initRequest,
	{ client }
) => {
	if(client.isInitialised) {
		throw AttestorError.badRequest('Client already initialised')
	}

	if(!SIGNATURES[initRequest.signatureType]) {
		throw AttestorError.badRequest('Unsupported signature type')
	}

	if(initRequest.clientVersion <= 0) {
		throw AttestorError.badRequest('Unsupported client version')
	}

	client.metadata = initRequest
	client.isInitialised = true

	return {}
}