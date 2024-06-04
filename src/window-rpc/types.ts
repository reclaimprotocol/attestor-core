import type { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import type { extractHTMLElement, extractJSONValueIndex } from '../providers/http/utils'
import type { CompleteClaimData, CreateClaimOnWitnessOpts, LogLevel, ProofGenerationStep, ProviderName, WitnessData } from '../types'

type IdentifiedMessage = {
	module: 'witness-sdk'
	/**
	 * Optionally, name of the channel to respond to
	 * Useful for specifying 'flutter_webview'
	 * channel
	 */
	channel?: string
	id: string
}

export type RPCCreateClaimOptions<N extends ProviderName = any> = Omit<CreateClaimOnWitnessOpts<N>, 'zkOperators'> & {
	/**
	 * Specify the mode for the ZK operator,
	 * 'default' -> will use the default ZK operator included in the SDK
	 * (presently that's SnarkJS supported by FFs running on WASM)
	 * 'rpc' -> if you've access to a native ZK operator, you can use this mode
	 * For eg. on React Native
	 */
	zkOperatorMode?: 'default' | 'rpc'
}

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
		/** Base64 encoded witness */
		witnessB64: string
	}
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

/**
 * Legacy V1 create claim response
 */
export type CreateClaimResponse = {
	identifier: string
	claimData: CompleteClaimData
	signatures: string[]
	witnesses: WitnessData[]
}

/**
 * Fns the app calls on the witness.
 * These are things done inside the witness
 */
export type WindowRPCClient = {
	/**
	 * Create a claim on the witness where the RPC SDK is hosted.
	 */
	createClaim(options: RPCCreateClaimOptions): Promise<CreateClaimResponse>
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
	 * Set the log level for the witness,
	 * optionally set "sendLogsToApp" to true to send logs
	 * back to the app
	 */
	setLogLevel(options: LogLevelOptions): Promise<void>
}

/**
 * Fns the witness calls on the app
 */
export type WindowRPCAppClient = {
	zkProve(opts: ZKProveOpts): ReturnType<ZKOperator['groth16Prove']>
	zkVerify(opts: ZKVerifyOpts): ReturnType<ZKOperator['groth16Verify']>
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
 * Data sent to the witness from the window/application
 */
// spread out each key because TS can't handle
export type WindowRPCIncomingMsg = (
	WindowRPCRequest<WindowRPCClient, 'createClaim'>
	| WindowRPCRequest<WindowRPCClient, 'extractHtmlElement'>
	| WindowRPCRequest<WindowRPCClient, 'extractJSONValueIndex'>
	| WindowRPCRequest<WindowRPCClient, 'getCurrentMemoryUsage'>
	| WindowRPCRequest<WindowRPCClient, 'setLogLevel'>
	| AsResponse<WindowRPCResponse<WindowRPCAppClient, 'zkProve'>>
	| AsResponse<WindowRPCResponse<WindowRPCAppClient, 'zkVerify'>>
	| AsResponse<WindowRPCErrorResponse>
) & IdentifiedMessage

/**
 * Data sent back from the witness to
 * the window/application containing the witness
 */
export type WindowRPCOutgoingMsg = (
	AsResponse<WindowRPCResponse<WindowRPCClient, 'createClaim'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'extractHtmlElement'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'extractJSONValueIndex'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'getCurrentMemoryUsage'>>
	| AsResponse<WindowRPCResponse<WindowRPCClient, 'setLogLevel'>>
	| WindowRPCRequest<WindowRPCAppClient, 'zkProve'>
	| WindowRPCRequest<WindowRPCAppClient, 'zkVerify'>
	| (
		{
			type: 'createClaimStep'
			step: {
				name: 'witness-progress'
				step: ProofGenerationStep
			}
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
