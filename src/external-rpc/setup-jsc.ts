import '#src/external-rpc/jsc-polyfills/index.ts'
1 // done to avoid eslint rule

import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto'

import * as AttestorRPCImport from '#src/external-rpc/index.ts'
import { makeLogger } from '#src/utils/logger.ts'

declare global {
	/**
	 * `sendMessage` function should be provided by the host of the JS environment for sending messages to host
	 */
	function sendMessage(channelName: string, message: any): void | Promise<void>

	var AttestorRPC: typeof AttestorRPCImport & {
		/**
		 * Sets up the library to run in JS environments like QuickJS or JavascriptCore.
		 *
		 * RPC will communicate with user by sending messages using `AttestorRPCChannel` by `<channel>.postMessage(message: string)`,
		 * for example: `globalThis['attestor-core'].postMessage(message: string)`.
		 *
		 * @param baseUrl
		 * @param channel The name of the channel for sending messages. Default channel is 'attestor-core'.
		 */
		setupJsRpc(baseUrl: string, channel?: string): void
	}
}

setCryptoImplementation(pureJsCrypto)
makeLogger(true)

/**
 * Sets up the library to run in JS environments like QuickJS or JavascriptCore.
 */
export function setupJsRpc(baseUrl: string, channel = 'attestor-core') {
	globalThis.ATTESTOR_BASE_URL = baseUrl
	globalThis.RPC_CHANNEL_NAME = channel
	const rpcChannel: AttestorRPCChannel = {
		postMessage(message) {
			return globalThis.sendMessage(channel, message)
		}
	}

	globalThis[channel] = rpcChannel
}

globalThis.AttestorRPC = { ...AttestorRPCImport, setupJsRpc }