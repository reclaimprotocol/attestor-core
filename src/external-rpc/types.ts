import type { OPRFOperator, ZKEngine, ZKOperator } from '@reclaimprotocol/zk-symmetric-crypto'
import '#src/external-rpc/global.d.ts'

import type { TaskCompletedEventObject } from '#src/avs/contracts/ReclaimServiceManager.ts'
import type { CreateClaimOnAvsOpts, CreateClaimOnAvsStep } from '#src/avs/types/index.ts'
import type { CreateClaimOnMechainStep } from '#src/mechain/types/index.ts'
import type { AuthenticationRequest } from '#src/proto/api.ts'
import type { extractHTMLElement, extractJSONValueIndex } from '#src/providers/http/utils.ts'
import type {
	AttestorData,
	CompleteClaimData,
	CreateClaimOnAttestorOpts,
	LogLevel,
	ProofGenerationStep,
	ProviderName,
	ProviderParams,
	ProviderSecretParams,
} from '#src/types/index.ts'
import type { HttpRequest, HttpResponse } from '#src/utils/index.ts'

type IdentifiedMessage = {
	id: string
}

type CreateClaimRPCBaseOpts = {
	/**
	 * Specify the mode for the ZK & OPRF operator,
	 * 'default' -> will use the default ZK operator included in the SDK
	 * (presently that's SnarkJS supported by FFs running on WASM)
	 * 'rpc' -> if you've access to a native ZK operator, you can use this mode
	 * For eg. on React Native
	 */
	zkOperatorMode?: 'default' | 'rpc'
	context?: string
	zkEngine?: ZKEngine
	updateProviderParams?: boolean
	authRequest?: AuthenticationRequest
}

export type RPCCreateClaimOptions<N extends ProviderName = any> = Omit<
	CreateClaimOnAttestorOpts<N>,
	'zkOperators' | 'context' | 'client'
> & CreateClaimRPCBaseOpts

export type RPCCreateClaimOnAvsOptions<N extends ProviderName = any> = Omit<
	CreateClaimOnAvsOpts<N>,
	'zkOperators' | 'context' | 'payer'
> & {
	payer?: 'attestor'
} & CreateClaimRPCBaseOpts

export type RPCCreateClaimOnMechainOptions<N extends ProviderName = any> = Omit<
	CreateClaimOnAvsOpts<N>,
	'zkOperators' | 'context'
> & CreateClaimRPCBaseOpts

type ExtractHTMLElementOptions = {
	html: string
	xpathExpression: string
	contentsOnly: boolean
}

type ExtractJSONValueIndexOptions = {
	json: string
	jsonPath: string
}

type UpdateProviderParamsOpts = {
	request: Omit<HttpRequest, 'body'> & { body: string | undefined }
	response: Omit<HttpResponse, 'body'> & { body: string | undefined }
}

type LogLevelOptions = {
	logLevel: LogLevel
	/**
	 * If true, log messages will be sent back to the app
	 * via postMessage
	 */
	sendLogsToApp: boolean
}

type AVSCreateResult = {
	object: TaskCompletedEventObject
	txHash: string
}

type MechainCreateResult = {
	taskId: number
	data: CreateClaimResponse[]
}

/**
 * Legacy V1 create claim response
 */
export type CreateClaimResponse = {
	identifier: string
	claimData: CompleteClaimData
	signatures: string[]
	/**
	 * @deprecated no longer valid
	 */
	witnesses: AttestorData[]
}

/**
 * Fns the app calls on the attestor.
 * These are things done inside the attestor
 */
export type ExternalRPCClient = {
	/**
	 * Create a claim on the attestor where the RPC SDK is hosted.
	 */
	createClaim(options: RPCCreateClaimOptions): Promise<CreateClaimResponse>
	/**
	 * Create a claim on the AVS
	 */
	createClaimOnAvs(opts: RPCCreateClaimOnAvsOptions): Promise<AVSCreateResult>
	/**
	 * Create a claim on Mechain
	 */
	createClaimOnMechain(opts: RPCCreateClaimOnMechainOptions): Promise<MechainCreateResult>
	/**
	 * Extract an HTML element from a string of HTML
	 */
	extractHtmlElement(options: ExtractHTMLElementOptions): Promise<ReturnType<typeof extractHTMLElement>>
	extractJSONValueIndex(options: ExtractJSONValueIndexOptions): Promise<ReturnType<typeof extractJSONValueIndex>>
	getCurrentMemoryUsage(): Promise<{
		available: boolean
		content: string
	}>
	/**
	 * Set the log level for the attestor,
	 * optionally set "sendLogsToApp" to true to send logs
	 * back to the app
	 */
	setLogLevel(options: LogLevelOptions): Promise<void>

	benchmarkZK(): Promise<string>

	ping(): Promise<{ pong: string }>
}

type AsFunction<K> = K extends (...args: any[]) => any ? K : never

type FunctionalOperator<T, K extends keyof T> = {
	fn: K
	args: Parameters<AsFunction<T[K]>>
}

export type ExecuteZKOpts<T extends keyof ZKOperator = keyof ZKOperator>
	= FunctionalOperator<ZKOperator, T>

export type ExecuteOPRFOpts<T extends keyof OPRFOperator = keyof OPRFOperator>
	= FunctionalOperator<OPRFOperator, T>

/**
 * Fns the attestor calls on the app
 */
export type ExternalRPCAppClient = {
	executeZkFunctionV3(opts: ExecuteZKOpts): Promise<any>
	executeOprfFunctionV3(opts: ExecuteOPRFOpts): Promise<any>

	updateProviderParams(opts: UpdateProviderParamsOpts): Promise<{
		params: Partial<ProviderParams<'http'>>
		secretParams: Partial<ProviderSecretParams<'http'>>
	}>
	/**
	 * The runtime needs to open a WebSocket connection. Is required for
	 * runtimes that do not support WebSockets natively.
	 *
	 * The app should facilitate this by opening a WebSocket connection
	 * to the given URL.
	 * "id" is a unique identifier for the WebSocket connection.
	 */
	connectWs(opts: { id: string, url: string }): Promise<{}>
	/**
	 * Runtime wants to disconnect a WebSocket connection.
	 * "code" is an optional close code,
	 * and "reason" is an optional reason for closing.
	 */
	disconnectWs(opts: { id: string, code?: number, reason?: any }): Promise<{}>
	/**
	 * Runtime wants to send a message over a WebSocket connection.
	 */
	sendWsMessage(opts: { id: string, data: ArrayBufferView | string }): Promise<{}>
}

type AnyRPCClient = { [_: string]: (opts: any) => any }

export type ExternalRPCRequest<T extends AnyRPCClient, K extends keyof T> = {
	type: K
	request: Parameters<T[K]>[0]
}

export type ExternalRPCResponse<T extends AnyRPCClient, K extends (keyof T) & string> = {
	type: `${K}Done`
	response: Awaited<ReturnType<T[K]>>
}

export type ExternalRPCErrorResponse = {
	type: 'error'
	data: {
		message: string
		stack: string
	}
}

type AsResponse<T> = T & { isResponse: true }

/**
 * Data sent to the attestor from the window/application
 */
// spread out each key because TS can't handle
export type ExternalRPCIncomingMsg = (
	ExternalRPCRequest<ExternalRPCClient, 'createClaim'>
	| ExternalRPCRequest<ExternalRPCClient, 'createClaimOnAvs'>
	| ExternalRPCRequest<ExternalRPCClient, 'createClaimOnMechain'>
	| ExternalRPCRequest<ExternalRPCClient, 'extractHtmlElement'>
	| ExternalRPCRequest<ExternalRPCClient, 'extractJSONValueIndex'>
	| ExternalRPCRequest<ExternalRPCClient, 'getCurrentMemoryUsage'>
	| ExternalRPCRequest<ExternalRPCClient, 'setLogLevel'>
  | ExternalRPCRequest<ExternalRPCClient, 'benchmarkZK'>
	| ExternalRPCRequest<ExternalRPCClient, 'ping'>
	| AsResponse<ExternalRPCResponse<ExternalRPCAppClient, 'executeZkFunctionV3'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCAppClient, 'executeOprfFunctionV3'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCAppClient, 'updateProviderParams'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCAppClient, 'connectWs'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCAppClient, 'disconnectWs'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCAppClient, 'sendWsMessage'>>
	| AsResponse<ExternalRPCErrorResponse>
	| ExternalRPCRequest<ExternalRPCAppClient, 'sendWsMessage'>
	| {
		type: 'disconnectWs'
		request: {
			id: string
			err?: string
		}
	}
) & IdentifiedMessage

/**
 * Data sent back from the attestor to
 * the window/application containing the attestor
 */
export type ExternalRPCOutgoingMsg = (
	AsResponse<ExternalRPCResponse<ExternalRPCClient, 'createClaim'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCClient, 'createClaimOnAvs'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCClient, 'extractHtmlElement'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCClient, 'extractJSONValueIndex'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCClient, 'getCurrentMemoryUsage'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCClient, 'setLogLevel'>>
  | AsResponse<ExternalRPCResponse<ExternalRPCClient, 'benchmarkZK'>>
	| AsResponse<ExternalRPCResponse<ExternalRPCClient, 'ping'>>
	| ExternalRPCRequest<ExternalRPCAppClient, 'executeZkFunctionV3'>
	| ExternalRPCRequest<ExternalRPCAppClient, 'executeOprfFunctionV3'>
	| ExternalRPCRequest<ExternalRPCAppClient, 'updateProviderParams'>
	| ExternalRPCRequest<ExternalRPCAppClient, 'connectWs'>
	| ExternalRPCRequest<ExternalRPCAppClient, 'disconnectWs'>
	| ExternalRPCRequest<ExternalRPCAppClient, 'sendWsMessage'>
	| (
		{
			type: 'createClaimStep'
			step: {
				name: 'attestor-progress' | 'witness-progress'
				step: ProofGenerationStep
			}
		}
	)
	| (
		{
			type: 'createClaimOnAvsStep'
			step: CreateClaimOnAvsStep
		}
	)
	| (
		{
			type: 'createClaimOnMechainStep'
			step: CreateClaimOnMechainStep
		}
	)
	| (
		{
			type: 'log'
			level: LogLevelOptions['logLevel']
			message: object
		}
	)
	| AsResponse<ExternalRPCErrorResponse>
) & IdentifiedMessage