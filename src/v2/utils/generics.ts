import { crypto, PACKET_TYPE, strToUint8Array, uint8ArrayToDataView } from '@reclaimprotocol/tls'
import { ReclaimRPCMessage } from '../../proto/api'
import { CompleteTLSPacket } from '../../types'
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

/**
 * Random ID for a tunnel.
 */
export function generateTunnelId() {
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

export function isApplicationData(
	packet: CompleteTLSPacket,
	tlsVersion: string
) {
	return packet.type === 'ciphertext'
		&& (
			packet.contentType === 'APPLICATION_DATA'
			|| (
				packet.data[0] === PACKET_TYPE.WRAPPED_RECORD
				&& tlsVersion === 'TLS1_2'
			)
		)
}

/**
 * Convert the received data from a WS to a Uint8Array
 */
export function extractArrayBufferFromWsData(data: unknown): Uint8Array {
	if(data instanceof ArrayBuffer) {
		return new Uint8Array(data)
	}

	// uint8array/Buffer
	if(typeof data === 'object' && data && 'buffer' in data) {
		return data as Uint8Array
	}

	if(typeof data === 'string') {
		return strToUint8Array(data)
	}

	throw new Error('unsupported data: ' + String(data))
}

/**
 * Check if the RPC message is a request or a response.
 */
export function getRpcRequest(msg: ReclaimRPCMessage) {
	if(msg.requestError) {
		return {
			direction: 'response' as const,
			type: 'error' as const
		}
	}

	for(const key in msg) {
		if(!msg[key]) {
			continue
		}

		const rpcType = getRpcTypeFromKey(key)
		if(!rpcType) {
			continue
		}

		return rpcType
	}
}