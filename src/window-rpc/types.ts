import type { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import type { TaskCompletedEventObject } from 'src/avs/contracts/ReclaimServiceManager'
import type { CreateClaimOnAvsOpts, CreateClaimOnAvsStep } from 'src/avs/types'
import type { extractHTMLElement, extractJSONValueIndex } from 'src/providers/http/utils'
import type {
	AttestorData,
	CompleteClaimData,
	CreateClaimOnAttestorOpts,
	LogLevel,
	ProofGenerationStep,
	ProviderName,
	ProviderParams,
	ProviderSecretParams,
	ZKEngine
} from 'src/types'
import { HttpRequest, HttpResponse } from 'src/utils'

type IdentifiedMessage = {
	module: 'attestor-core'
	/**
	 * Optionally, name of the channel to respond to
	 * Useful for specifying 'flutter_webview'
	 * channel
	 */
	channel?: string
	id: string
}

type CreateClaimRPCBaseOpts = {
	/**
	 * Specify the mode for the ZK operator,
	 * 'default' -> will use the default ZK operator included in the SDK
	 * (presently that's SnarkJS supported by FFs running on WASM)
	 * 'rpc' -> if you've access to a native ZK operator, you can use this mode
	 * For eg. on React Native
	 */
	zkOperatorMode?: 'default' | 'rpc'
	context?: string
	zkEngine?: ZKEngine
	updateProviderParams?: boolean
}

export type RPCCreateClaimOptions<N extends ProviderName = any> = Omit<
	CreateClaimOnAttestorOpts<N>,
	'zkOperators' | 'context'
> & CreateClaimRPCBaseOpts

export type RPCCreateClaimOnAvsOptions<N extends ProviderName = any> = Omit<
	CreateClaimOnAvsOpts<N>,
	'zkOperators' | 'context' | 'payer'
> & {
	payer?: 'attestor'
} & CreateClaimRPCBaseOpts

type ExtractHTMLElementOptions = {
	html: string
	xpathExpression: string
	contentsOnly: boolean
}

type ExtractJSONValueIndexOptions = {
	json: string
	jsonPath: string
}

type ZKProveOpts = {
	algorithm: EncryptionAlgorithm
	input: {
		/** Base64 encoded attestor */
		witnessB64: string
	}
}

type UpdateProviderParamsOpts = {
	request: Omit<HttpRequest, 'body'> & { body: string | undefined }
	response: Omit<HttpResponse, 'body'> & { body: string | undefined }
}

type ZKVerifyOpts = {
	algorithm: EncryptionAlgorithm
	publicSignals: number[]
	proof: { [key: string]: string } | string
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
export type WindowRPCClient = {
	/**
	 * Create a claim on the attestor where the RPC SDK is hosted.
	 */
	createClaim(options: RPCCreateClaimOptions): Promise<CreateClaimResponse>
	/**
	 * Create a claim on the AVS
	 */
	createClaimOnAvs(opts: RPCCreateClaimOnAvsOptions): Promise<AVSCreateResult>
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
}

/**
 * Fns the attestor calls on the app
 */
export type WindowRPCAppClient = {
	zkProve(opts: ZKProveOpts): ReturnType<ZKOperator['groth16Prove']>
	zkVerify(opts: ZKVerifyOpts): ReturnType<ZKOperator['groth16Verify']>
	updateProviderParams(opts: UpdateProviderParamsOpts): Promise<{
		params: Partial<ProviderParams<'http'>>
		secretParams: Partial<ProviderSecretParams<'http'>>
	}>
}

type AnyRPCClient = { [_: string]: (opts: any) => any }

export type WindowRPCRequest<T extends AnyRPCClient, K extends keyof T> = {
	type: K
	request: Parameters<T[K]>[0]
}

export type WindowRPCResponse<T extends AnyRPCClient, K extends (keyof T) & string> = {
	type: `${K}Done`
	response: Awaited<ReturnType<T[K]>>
}

export type WindowRPCErrorResponse = {
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
export type WindowRPCIncomingMsg = (
	WindowRPCRequest<WindowRPCClient, 'createClaim'>
	| WindowRPCRequest<WindowRPCClient, 'createClaimOnAvs'>
	| WindowRPCRequest<WindowRPCClient, 'extractHtmlElement'>
	| WindowRPCRequest<WindowRPCClient, 'extractJSONValueIndex'>
	| WindowRPCRequest<WindowRPCClient, 'getCurrentMemoryUsage'>
	| WindowRPCRequest<WindowRPCClient, 'setLogLevel'>
    | WindowRPCRequest<WindowRPCClient, 'benchmarkZK'>
	| AsResponse<WindowRPCResponse<WindowRPCAppClient, 'zkProve'>>
	| AsResponse<WindowRPCResponse<WindowRPCAppClient, 'zkVerify'>>
	| AsResponse<WindowRPCResponse<WindowRPCAppClient, 'updateProviderParams'>>
	| AsResponse<WindowRPCErrorResponse>
) & IdentifiedMessage

/**
 * Data sent back from the attestor to
 * the window/application containing the attestor
 */
export type WindowRPCOutgoingMsg = (
	AsResponse<WindowRPCResponse<WindowRPCClient, 'createClaim'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'createClaimOnAvs'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'extractHtmlElement'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'extractJSONValueIndex'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'getCurrentMemoryUsage'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'setLogLevel'>>
    | AsResponse<WindowRPCResponse<WindowRPCClient, 'benchmarkZK'>>
	| WindowRPCRequest<WindowRPCAppClient, 'zkProve'>
	| WindowRPCRequest<WindowRPCAppClient, 'zkVerify'>
	| WindowRPCRequest<WindowRPCAppClient, 'updateProviderParams'>
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
			type: 'log'
			level: LogLevelOptions['logLevel']
			message: object
		}
	)
	| AsResponse<WindowRPCErrorResponse>
) & IdentifiedMessage

export type CommunicationBridge = {
	send(msg: WindowRPCOutgoingMsg): void
	onMessage(
		cb: (msg: WindowRPCIncomingMsg) => void
	): (() => void)
}

declare global {
	interface Performance {
		measureUserAgentSpecificMemory(): { bytes: number }
	}
}
