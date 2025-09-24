import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto'

import { handleIncomingMessage } from '#src/external-rpc/handle-incoming-msg.ts'
import { getWsApiUrlFromBaseUrl } from '#src/external-rpc/utils.ts'
import { logger, makeLogger } from '#src/utils/index.ts'

makeLogger(true)

setCryptoImplementation(webcryptoCrypto)

/**
 * For browsers only. Sets up the current window to listen for RPC requests
 * from React Native or other windows
 */
export function setupWindowRpc(baseUrl?: string, channel = 'attestor-core') {
	if(baseUrl) {
		globalThis.ATTESTOR_BASE_URL = baseUrl
	} else if(typeof window !== 'undefined' && window.location) {
		globalThis.ATTESTOR_BASE_URL = window.location.toString()
	} else {
		throw new Error('No base URL provided and window.location unavailable')
	}

	if(channel) {
		globalThis.RPC_CHANNEL_NAME = channel
	} else if(!globalThis.RPC_CHANNEL_NAME) {
		throw new Error('No channel name provided and globalThis.RPC_CHANNEL_NAME unavailable')
	}

	if(typeof window !== 'undefined') {
		window.addEventListener(
			'message',
			ev => handleIncomingMessage(ev.data),
			false
		)
	}

	logger.info({ defaultUrl: getWsApiUrlFromBaseUrl() }, 'window RPC setup')
}

export * from '#src/index.ts'