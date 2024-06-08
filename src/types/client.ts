import type { InitRequest, RPCMessage, RPCMessages, ServiceSignatureType, TunnelMessage } from '../proto/api'
import type { Logger } from './general'
import type { RPCEvent, RPCEventMap, RPCEventType, RPCRequestData, RPCResponseData, RPCType } from './rpc'
import type { TCPSocketProperties, Tunnel } from './tunnel'

export type IWitnessClientCreateOpts = {
	/**
	 * Witness WS URL
	 */
	url: string | URL

	signatureType?: ServiceSignatureType

	logger?: Logger
	/**
	 * Initial messages to send to the server
	 * in the query parameter used to establish
	 * the connection.
	 */
	initMessages?: Partial<RPCMessage>[]
}

/**
 * Base layer for the WebSocket connection on
 * the client and server.
 */
export declare class IWitnessSocket {
	metadata: InitRequest
	logger: Logger

	/**
	 * Is the WebSocket connection open?
	 */
	isOpen: boolean
	/**
	 * Has the WebSocket connection been closed
	 */
	isClosed: boolean
	/**
	 * Whether the WebSocket has been initialised
	 * by receiving an "init-response" message.
	 */
	isInitialised: boolean

	/**
	 * Sends RPC messages to the server in a single packet.
	 * If the ID is not provided, it will be generated.
	 *
	 * Promisify the `send` method if using the `ws` package's
	 * WebSocket implementation.
	 */
	sendMessage(...msgs: Partial<RPCMessage>[]): Promise<RPCMessages>
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
	removeEventListener<K extends RPCEventType>(
		type: K,
		listener: (data: RPCEvent<K>) => void
	): void

	/**
	 * Syntactic sugar for emitting events on the WebSocket.
	 * Wraps the `makeRpcEvent` call internally
	 */
	dispatchRPCEvent<K extends RPCEventType>(
		type: K,
		data: RPCEventMap[K]
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
	constructor(
		ws: WebSocket,
		metadata: InitRequest,
		logger: Logger
	)
}

export declare class IWitnessServerSocket extends IWitnessSocket {

	/**
	 * Unique identifier for this WebSocket connection
	 */
	sessionId: number
	/**
	 * Set of tunnels this client created. Only available
	 * when WS is created by the server
	 */
	tunnels: { [id: TunnelMessage['tunnelId']]: Tunnel<TCPSocketProperties> }

	/**
	 * Fetches a tunnel by its ID.
	 * If the tunnel does not exist, it will throw an error.
	 */
	getTunnel(tunnelId: TunnelMessage['tunnelId']): Tunnel<TCPSocketProperties>
}

export declare class IWitnessClient extends IWitnessSocket {
	constructor(opts: IWitnessClientCreateOpts)

	/**
	 * Waits for a particular message to come in.
	 * If the connection is closed before the message is received,
	 * the promise will reject.
	 */
	waitForResponse<T extends RPCType>(
		id: number
	): Promise<RPCResponseData<T>>
	/**
	 * Make an RPC request to the other end of the WebSocket.
	 */
	rpc<T extends RPCType>(
		type: T,
		request: Partial<RPCRequestData<T>>
	): Promise<RPCResponseData<T>>
	/**
	 * Waits for the "init" request to be responded to
	 */
	waitForInit(): Promise<void>
}

interface WebSocketWithServerSocket {
	/**
	 * Our RPC socket instance
	 */
	serverSocket?: IWitnessServerSocket
}

declare module 'ws' {
	namespace WebSocket {
		interface WebSocket extends WebSocketWithServerSocket {}
	}

	interface WebSocket extends WebSocketWithServerSocket {}
}