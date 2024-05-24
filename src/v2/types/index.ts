import type { Transaction } from 'elastic-apm-node'
import type { Empty, InitRequest, ReclaimRPCMessage, ServiceSignatureType, TunnelDisconnectEvent, TunnelMessage } from '../../proto/api'
import type { ProviderName, ProviderParams, ProviderSecretParams } from '../../providers'
import type { Logger, PrepareZKProofsBaseOpts, ProofGenerationStep } from '../../types'
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

declare class WitnessClient {

	metadata: InitRequest
	/**
	 * Set of tunnels this client created. Only available
	 * when WS is created by the server
	 */
	tunnels: { [id: TunnelMessage['tunnelId']]: Tunnel<{}> }

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

	connect(): Promise<void>
	/**
	 * Sign some data with the private key of the client.
	 * Only available on client-side WebSockets.
	 */
	sign(data: Uint8Array): Promise<Uint8Array>
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
	rpc<T extends RPCType>(
		type: T,
		request: Partial<RPCRequestData<T>>
	): Promise<RPCResponseData<T>>
	/**
	 * Waits for the "init-response" event to be emitted,
	 * if already initialised, it will resolve immediately.
	 */
	waitForInit(): Promise<void>
}

declare global {
	interface WebSocket extends WitnessClient {}
}

export type MakeTunnelBaseOpts<O> = O & {
	logger?: Logger
	onClose?(err?: Error): void
	onMessage?(data: Uint8Array): void
}

export type Tunnel<E> = E & {
	write(data: Uint8Array): void
	close(err?: Error): void
}

export type MakeTunnelFn<O, E = {}> = (opts: MakeTunnelBaseOpts<O>) => (
	Tunnel<E> | Promise<Tunnel<E>>
)

export type Transcript<T> = {
	sender: 'client' | 'server'
	message: T
}[]

export type RPCHandlerMetadata = {
	logger: Logger
	tx?: Transaction
	client: WebSocket
}

export type RPCHandler<R extends RPCType> = (
	data: RPCRequestData<R>,
	ctx: RPCHandlerMetadata
) => Promise<RPCResponseData<R>>

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
	/**
	 * Client to generate the claim through
	 */
	client: WebSocket

	logger: Logger
} & PrepareZKProofsBaseOpts