import type { RPCMessage, TunnelDisconnectEvent, TunnelMessage } from 'src/proto/api'
import type { AttestorError } from 'src/utils/error'

// simple typescript type to extract all fields that end with the givens suffix
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ExtractPrefix<T, S extends string> = T extends `${infer _}${S}` ? _ : never

export type RPCType = ExtractPrefix<keyof RPCMessage, 'Request'>

// extract all request & response types from the RPCMessage type
type RPCRequestType<T extends RPCType> = `${T}Request`
type RPCResponseType<T extends RPCType> = `${T}Response`
// data types for the request & response types
export type RPCRequestData<T extends RPCType> = Exclude<RPCMessage[RPCRequestType<T>], undefined>
export type RPCResponseData<T extends RPCType> = Exclude<RPCMessage[RPCResponseType<T>], undefined>

export type RPCRequest<T extends RPCType> = {
	requestId: RPCMessage['id']
	type: T
	data: RPCRequestData<T>
	respond(res: RPCResponseData<T> | AttestorError): void
}

export type RPCResponse<T extends RPCType> = {
	id: RPCMessage['id']
	type: T
	data: RPCResponseData<T>
} | {
	id: RPCMessage['id']
	error: AttestorError
}

export type RPCEventMap = {
	'connection-terminated': AttestorError
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