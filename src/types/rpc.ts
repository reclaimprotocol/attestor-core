import type { Empty, ReclaimRPCMessage, TunnelDisconnectEvent, TunnelMessage } from '../proto/api'
import type { WitnessError } from '../utils/error'

// simple typescript type to extract all fields that end with the givens suffix
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ExtractPrefix<T, S extends string> = T extends `${infer _}${S}` ? _ : never

export type RPCType = ExtractPrefix<keyof ReclaimRPCMessage, 'Request'>

// extract all request & response types from the ReclaimRPCMessage type
type RPCRequestType<T extends RPCType> = `${T}Request`
type RPCResponseType<T extends RPCType> = `${T}Response`
// data types for the request & response types
export type RPCRequestData<T extends RPCType> = Exclude<ReclaimRPCMessage[RPCRequestType<T>], undefined>
export type RPCResponseData<T extends RPCType> = Exclude<ReclaimRPCMessage[RPCResponseType<T>], undefined>

export type RPCRequest<T extends RPCType> = {
	requestId: ReclaimRPCMessage['id']
	type: T
	data: RPCRequestData<T>
	respond(res: RPCResponseData<T> | WitnessError): void
}

export type RPCResponse<T extends RPCType> = {
	id: ReclaimRPCMessage['id']
	type: T
	data: RPCResponseData<T>
} | {
	id: ReclaimRPCMessage['id']
	error: WitnessError
}

export type RPCEventMap = {
	'init-response': Empty
	'connection-terminated': WitnessError
	'tunnel-message': TunnelMessage
	'tunnel-disconnect-event': TunnelDisconnectEvent
	'rpc-request': RPCRequest<RPCType>
	'rpc-response': RPCResponse<RPCType>
}

export type RPCEventType = keyof RPCEventMap

export interface RPCEvent<T extends RPCEventType> extends Event {
	type: T
	data: RPCEventMap[T]
}