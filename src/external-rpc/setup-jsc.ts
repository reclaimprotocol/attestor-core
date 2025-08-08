import '#src/external-rpc/jsc-polyfills/index.ts'
1 // done to avoid eslint rule

import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto'

import { makeLogger } from '#src/utils/logger.ts'

declare global {
	/**
	 * FlutterJS sendMessage fn
	 * https://pub.dev/packages/flutter_js/example
	 */
	function sendMessage(channelName: string, message: any): void | Promise<void>
}

setCryptoImplementation(pureJsCrypto)
makeLogger(true)

/**
 * Sets up the library to run in JSC environments like QuickJS or JavascriptCore.
 * inside a Flutter app.
 *
 */
export function setupFlutterJsRpc(baseUrl: string, channel = 'attestor-core') {
	globalThis.ATTESTOR_BASE_URL = baseUrl
	globalThis.RPC_CHANNEL_NAME = channel
	const rpcChannel: AttestorRPCChannel = {
		postMessage(message) {
			return globalThis.sendMessage(channel, message)
		}
	}

	globalThis[channel] = rpcChannel
}

export * from '#src/external-rpc/index.ts'