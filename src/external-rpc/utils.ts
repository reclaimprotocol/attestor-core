import { WS_PATHNAME } from '#src/config/index.ts'
import { EventBus } from '#src/external-rpc/event-bus.ts'
import type { ExternalRPCAppClient, ExternalRPCIncomingMsg, ExternalRPCOutgoingMsg, ExternalRPCRequest, ExternalRPCResponse } from '#src/external-rpc/types.ts'
import { B64_JSON_REPLACER } from '#src/utils/b64-json.ts'
import { AttestorError } from '#src/utils/error.ts'

export const RPC_MSG_BRIDGE = new EventBus<ExternalRPCIncomingMsg>()

// track memory usage
export async function getCurrentMemoryUsage() {
	if(!window.crossOriginIsolated) {
		return {
			available: false,
			content: 'N/A (page not cross-origin-isolated)'
		}
	} else if(!performance.measureUserAgentSpecificMemory) {
		return {
			available: false,
			content: 'N/A (performance.measureUserAgentSpecificMemory() is not available)',
		}
	} else {
		try {
			const result = performance.measureUserAgentSpecificMemory()
			const totalmb = Math.round(result.bytes / 1024 / 1024)

			return { available: true, content: `${totalmb}mb` }
		} catch(error) {
			if(error instanceof DOMException && error.name === 'SecurityError') {
				return { available: false, content: `N/A (${error.message})` }
			}

			throw error
		}
	}
}

export function generateRpcRequestId() {
	return Math.random().toString(36).slice(2)
}

/**
 * The window RPC will be served from the same origin as the API server.
 * so we can get the API server's origin from the location.
 */
export function getWsApiUrlFromBaseUrl() {
	if(typeof ATTESTOR_BASE_URL !== 'string') {
		throw new Error('ATTESTOR_BASE_URL is not set')
	}

	const parsed = new URL(ATTESTOR_BASE_URL)
	const { host, protocol } = parsed
	const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
	return `${wsProtocol}//${host}${WS_PATHNAME}`
}

export function rpcRequest<T extends keyof ExternalRPCAppClient>(
	opts: ExternalRPCRequest<ExternalRPCAppClient, T>
): Promise<ExternalRPCResponse<ExternalRPCAppClient, T>['response']> {
	const id = generateRpcRequestId()
	const waitForRes = waitForResponse(opts.type, id)

	// @ts-expect-error
	sendMessageToApp({
		id,
		type: opts.type,
		request: opts.request,
	})

	return waitForRes
}

export function waitForResponse<T extends keyof ExternalRPCAppClient>(
	type: T,
	requestId: string,
	timeoutMs = 60_000
) {
	type R = Awaited<ReturnType<ExternalRPCAppClient[T]>>
	const returnType = `${type}Done` as const
	return new Promise<R>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new AttestorError(
					'ERROR_INTERNAL',
					`Timeout waiting for response: ${type}`,
					{ requestId }
				)
			)
			cancel()
		}, timeoutMs)

		const cancel = RPC_MSG_BRIDGE.addListener(msg => {
			if(msg.id !== requestId) {
				return
			}

			if(msg.type === 'error') {
				reject(new Error(msg.data.message))
			} else if(msg.type === returnType) {
				resolve(msg.response as R)
			} else {
				return
			}

			clearTimeout(timeout)
			cancel()
		})
	})
}

/**
 * Sends a message back to the host app
 * @param data
 */
export function sendMessageToApp(data: ExternalRPCOutgoingMsg) {
	const str = JSON.stringify(data, B64_JSON_REPLACER)
	if(!RPC_CHANNEL_NAME) {
		throw new Error('global RPC_CHANNEL_NAME is not set')
	}

	const channel = globalThis[RPC_CHANNEL_NAME] as AttestorRPCChannel
	if(!channel) {
		throw new Error(`RPC channel ${RPC_CHANNEL_NAME} not set on globalThis`)
	}

	channel.postMessage(str)
}