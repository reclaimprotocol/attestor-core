import { crypto, uint8ArrayToDataView } from '@reclaimprotocol/tls'
import { RPCEvent, RPCEventMap, RPCEventType, RPCType } from '../types'

export function generateRpcMessageId() {
	return uint8ArrayToDataView(
		crypto.randomBytes(8)
	).getUint32(0)
}

/**
 * Random session ID for a WebSocket client.
 */
export function generateSessionId() {
	return generateRpcMessageId()
}

export function makeRpcEvent<T extends RPCEventType>(
	type: T,
	data: RPCEventMap[T]
) {
	const ev = new Event(type) as RPCEvent<T>
	ev.data = data
	return ev
}

/**
 * Get the RPC type from the key.
 * For eg. "claimTunnelRequest" ->
 * 	{ type: 'claimTunnel', direction: 'request' }
 */
export function getRpcTypeFromKey(key: string) {
	if(key.endsWith('Request')) {
		return {
			type: key.slice(0, -7) as RPCType,
			direction: 'request' as const
		}
	}

	if(key.endsWith('Response')) {
		return {
			type: key.slice(0, -8) as RPCType,
			direction: 'response' as const
		}
	}
}

/**
 * Get the RPC response type from the RPC type.
 * For eg. "claimTunnel" -> "claimTunnelResponse"
 */
export function getRpcResponseType<T extends RPCType>(type: T) {
	return `${type}Response` as const
}

/**
 * Get the RPC request type from the RPC type.
 * For eg. "claimTunnel" -> "claimTunnelRequest"
 */
export function getRpcRequestType<T extends RPCType>(type: T) {
	return `${type}Request` as const
}