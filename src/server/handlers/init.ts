import { ethers } from 'ethers'
import { RPCHandler } from 'src/types'
import { AttestorError } from 'src/utils'
import { assertValidAuthRequest } from 'src/utils/auth'
import { getEnvVariable } from 'src/utils/env'
import { SIGNATURES } from 'src/utils/signatures'

const TOPRF_PUBLIC_KEY = getEnvVariable('TOPRF_PUBLIC_KEY')

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

	await assertValidAuthRequest(
		initRequest.auth,
		initRequest.signatureType
	)

	if(initRequest.auth?.data) {
		client.logger = client.logger.child({
			userId: initRequest.auth.data.id
		})
	}

	client.metadata = initRequest
	client.isInitialised = true

	return {
		toprfPublicKey: TOPRF_PUBLIC_KEY
			? ethers.utils.arrayify(TOPRF_PUBLIC_KEY)
			: new Uint8Array()
	}
}