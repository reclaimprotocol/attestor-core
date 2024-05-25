import type { ClaimTunnelResponse, InitRequest, ReclaimRPCMessage, ServiceSignatureType, TunnelMessage } from '../../proto/api'
import type { ProviderName, ProviderParams, ProviderSecretParams } from '../../providers'
import type { Logger, PrepareZKProofsBaseOpts, ProofGenerationStep } from '../../types'
import type { RPCEvent, RPCEventMap, RPCEventType, RPCRequestData, RPCResponseData, RPCType } from './rpc'
import type { TCPSocketProperties, Tunnel } from './tunnel'

export type WitnessClientOpts = {
	/**
	 * Private key in hex format,
	 * prefixed with '0x'
	 */
	privateKeyHex: string

	url: string | URL

	signatureType?: ServiceSignatureType

	logger?: Logger
}

export type CreateClaimOpts<N extends ProviderName> = {
	/** name of the provider to generate signed receipt for */
	name: N
	/**
	 * secrets that are used to make the API request;
	 * not included in the receipt & cannot be viewed by anyone
	 * outside this client
	 */
	secretParams: ProviderSecretParams<N>
	params: ProviderParams<N>
	/**
	 * Some metadata context to be included in the claim
	 */
	context?: { [key: string]: any }

	onStep?(step: ProofGenerationStep): void
} & PrepareZKProofsBaseOpts

/**
 * Wrapper around a websocket, that provides methods
 * to help with RPC communication.
 */
export declare class IWitnessSocket {
	metadata: InitRequest
	logger: Logger

	/**
	 * Is the WebSocket connection open?
	 */
	isOpen: boolean
	/**
	 * Whether the WebSocket has been initialised
	 * by receiving an "init-response" message.
	 */
	isInitialised: boolean

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
	constructor(opts: WitnessClientOpts)

	/**
	 * Sign some data with the private key of the client.
	 * Only available on client-side WebSockets.
	 */
	sign(data: Uint8Array): Promise<Uint8Array>
	/**
	 * Make an RPC request to the other end of the WebSocket.
	 */
	rpc<T extends RPCType>(
		type: T,
		request: Partial<RPCRequestData<T>>
	): Promise<RPCResponseData<T>>
	/**
	 * Waits for the "init-response" event to be emitted,
	 * if already initialised, it will resolve immediately.
	 */
	waitForInit(): Promise<void>

	createClaim<N extends ProviderName>(
		opts: CreateClaimOpts<N>
	): Promise<ClaimTunnelResponse>
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