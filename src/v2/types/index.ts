import type { Transaction } from 'elastic-apm-node'
import { ClaimConnectionRequest, CreateTunnelRequest, DisconnectTunnelRequest, Empty, InitRequest, ReclaimRPCMessage, ServiceSignatureType, TunnelDisconnectEvent, TunnelMessage } from '../../proto/api'
import type { Logger } from '../../types'
import type { WitnessError } from '../../utils/error'

export type MakeWitnessClientOptions = {
	/**
	 * Private key in hex format,
	 * prefixed with '0x'
	 */
	privateKeyHex: string

	url: string | URL

	signatureType?: ServiceSignatureType

	logger?: Logger
}


/**
 * Match all request types to their corresponding response types,
 * this is a statically typed object -- so we can use this in the JS
 * to find the corresponding response object for a given request object
 * in the received message.
 */
export const REQUEST_RESPONSE_MATCHES = {
	createTunnelRequest: {
		data: CreateTunnelRequest,
		response: {
			type: 'createTunnelResponse',
			data: Empty
		}
	},
	disconnectTunnelRequest: {
		data: DisconnectTunnelRequest,
		response: {
			type: 'disconnectTunnelResponse',
			data: Empty
		}
	},
	claimConnectionRequest: {
		data: ClaimConnectionRequest,
		response: {
			type: 'claimConnectionResponse',
			data: ClaimConnectionRequest
		}
	}
} as const

export type RPCRequestType = keyof typeof REQUEST_RESPONSE_MATCHES

export type RPCRequestData<T extends RPCRequestType> = (
	ReturnType<(typeof REQUEST_RESPONSE_MATCHES)[T]['data']['create']>
)

export type RPCResponseData<T extends RPCRequestType> = (
	ReturnType<(typeof REQUEST_RESPONSE_MATCHES)[T]['response']['data']['create']>
)

export type RPCResponseType<T extends RPCRequestType> = (
	(typeof REQUEST_RESPONSE_MATCHES)[T]['response']['type']
)

export type RPCRequest<T extends RPCRequestType> = {
	requestId: ReclaimRPCMessage['id']
	type: T
	data: RPCRequestData<T>
	respond(
		res: RPCResponseData<T> | WitnessError
	): void
}

export type RPCResponse<T extends RPCRequestType> = {
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
	'rpc-request': RPCRequest<RPCRequestType>
	'rpc-response': RPCResponse<RPCRequestType>
}

export type RPCEventType = keyof RPCEventMap

export interface RPCEvent<T extends RPCEventType> extends Event {
	type: T
	data: RPCEventMap[T]
}

declare global {
	interface WebSocket {
		metadata: InitRequest

		/**
		 * Set of tunnels this client created. Only available
		 * when WS is created by the server
		 */
		tunnels: { [id: TunnelMessage['tunnelId']]: Tunnel<Uint8Array> }

		logger?: Logger
		/**
		 * Whether the WebSocket has been initialised
		 * by receiving an "init-response" message.
		 */
		initialised?: boolean
		/**
		 * Is the WebSocket connection open?
		 */
		isOpen: boolean
		/**
		 * Sends an RPC message to the server.
		 * If the ID is not provided, it will be generated.
		 *
		 * Promisify the `send` method if using the `ws` package's
		 * WebSocket implementation.
		 */
		sendMessage(msg: Partial<ReclaimRPCMessage>): Promise<void>
		/**
		 * Sends a "terminateConnectionAlert" message to the server
		 * with the specified error (if any), if the connection is
		 * still open and then closes the connection.
		 */
		terminateConnection(err?: Error): Promise<void>
		/**
		 * Use this to listen to events on the WebSocket.
		 */
		addEventListener<K extends RPCEventType>(
			type: K,
			listener: (data: RPCEvent<K>) => void
		): void
		/**
		 * Starts processing RPC messages from the WebSocket
		 * & emits events for each message type. These can be
		 * captured by the `addEventListener` method.
		 *
		 * Will also listen to "error" & "close" events on the WebSocket
		 * and emit a "witness-error" event with the error.
		 * So, you only need to listen to the "witness-error"
		 * event to capture anything you're interested in.
		 */
		startProcessingRpcMessages(): void
		/**
		 * Syntactic sugar for emitting events on the WebSocket.
		 * Wraps the `makeRpcEvent` call internally
		 */
		dispatchRPCEvent<K extends RPCEventType>(
			type: K,
			data: RPCEventMap[K]
		): void
		/**
		 * Make an RPC request to the other end of the WebSocket.
		 */
		rpc<T extends RPCRequestType>(
			type: T,
			request: Partial<RPCRequestData<T>>
		): Promise<RPCResponseData<T>>
		/**
		 * Waits for the "init-response" event to be emitted,
		 * if already initialised, it will resolve immediately.
		 */
		waitForInit(): Promise<void>
	}
}

export type MakeTunnelBaseOpts<M, O> = O & {
	logger?: Logger
	onClose?(err?: Error): void
	onMessage?(data: M): void
}

export type Tunnel<M> = {
	write(data: M): void
	close(err?: Error): void
}

export type MakeTunnelFn<M, O> = (opts: MakeTunnelBaseOpts<M, O>) => (
	Tunnel<M> | Promise<Tunnel<M>>
)

export type RPCHandlerMetadata = {
	logger: Logger
	tx?: Transaction
	client: WebSocket
}

export type RPCHandler<R extends RPCRequestType> = (
	data: RPCRequestData<R>,
	ctx: RPCHandlerMetadata
) => Promise<RPCResponseData<R>>