import type { IncomingMessage } from 'http'
import type { AuthenticationRequest, InitRequest, InitResponse, RPCMessage, RPCMessages, ServiceSignatureType, TunnelMessage } from 'src/proto/api'
import type { BGPListener } from 'src/types/bgp'
import type { Logger } from 'src/types/general'
import type { RPCEvent, RPCEventMap, RPCEventType, RPCRequestData, RPCResponseData, RPCType } from 'src/types/rpc'
import type { TCPSocketProperties, Tunnel } from 'src/types/tunnel'
import type { WebSocket as WSWebSocket } from 'ws'

/**
 * Any WebSocket implementation -- either the native
 * WebSocket or the WebSocket from the `ws` package.
 */
export type AnyWebSocket = WebSocket | WSWebSocket

export type MakeWebSocket = (url: string | URL) => AnyWebSocket

export type AcceptNewConnectionOpts = {
	req: IncomingMessage
	logger: Logger
	bgpListener?: BGPListener
}

export type IAttestorClientInitParams = {
	/**
	 * Attestor WS URL
	 */
	url: string | URL
	/**
	 * If the attestor being connected to has authentication
	 * enabled, provide the authentication request here, or a
	 * function that will return the authentication request.
	 */
	authRequest?: AuthenticationRequest
		| (() => Promise<AuthenticationRequest>)
}

export type IAttestorClientCreateOpts = {
	/**
	 * Attestor WS URL
	 */
	url: string | URL

	authRequest?: AuthenticationRequest

	signatureType?: ServiceSignatureType

	logger?: Logger
	/**
	 * Initial messages to send to the server
	 * in the query parameter used to establish
	 * the connection.
	 */
	initMessages?: Partial<RPCMessage>[]
	/**
	 * Provide a custom WebSocket implementation,
	 * will use the native WebSocket if not provided.
	 */
	makeWebSocket?: MakeWebSocket
}

/**
 * Base layer for the WebSocket connection on
 * the client and server.
 */
export declare class IAttestorSocket {
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
	 * and emit a "attestor-error" event with the error.
	 * So, you only need to listen to the "attestor-error"
	 * event to capture anything you're interested in.
	 */
	constructor(
		ws: WebSocket,
		metadata: InitRequest,
		logger: Logger
	)
}

export declare class IAttestorServerSocket extends IAttestorSocket {

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

	removeTunnel(tunnelId: TunnelMessage['tunnelId']): void

	bgpListener?: BGPListener
}

export declare class IAttestorClient extends IAttestorSocket {

	public initResponse?: InitResponse

	constructor(opts: IAttestorClientCreateOpts)

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
	serverSocket?: IAttestorServerSocket
	/**
	 * Just promisified send
	 */
	sendPromise?: (data: Uint8Array) => Promise<void>
}

declare module 'ws' {
	namespace WebSocket {
		interface WebSocket extends WebSocketWithServerSocket {}
	}

	interface WebSocket extends WebSocketWithServerSocket {}
}