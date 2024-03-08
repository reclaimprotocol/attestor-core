import type { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import type { createClaim, CreateClaimOptions } from '../api-client'
import type { ProviderName } from '../providers'
import type { extractHTMLElement, extractJSONValueIndex } from '../providers/http-provider/utils'
import type { CreateStep } from '../types'

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

export type RPCCreateClaimOptions<N extends ProviderName = any> = Omit<CreateClaimOptions<N>, 'zkOperators'> & {
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
	input: { [_: string]: any }
}

type ZKVerifyOpts = {
	algorithm: EncryptionAlgorithm
	publicSignals: number[]
	proof: { [_: string]: any }
}

/**
 * Fns the app calls on the witness.
 * These are things done inside the witness
 */
export type RPCWitnessClient = {
	createClaim(options: RPCCreateClaimOptions): ReturnType<typeof createClaim>
	extractHtmlElement(options: ExtractHTMLElementOptions): ReturnType<typeof extractHTMLElement>
	extractJSONValueIndex(options: ExtractJSONValueIndexOptions): ReturnType<typeof extractJSONValueIndex>
	getCurrentMemoryUsage(): Promise<{
		available: boolean
		content: string
	}>
}

/**
 * Fns the witness calls on the app
 */
export type RPCAppClient = {
	zkProve(opts: ZKProveOpts): ReturnType<ZKOperator['groth16FullProve']>
	zkVerify(opts: ZKVerifyOpts): ReturnType<ZKOperator['groth16Verify']>
}

type AnyRPCClient = { [_: string]: (opts: any) => any }

export type RPCRequest<T extends AnyRPCClient, K extends keyof T> = {
	type: K
	request: Parameters<T[K]>[0]
}

export type RPCResponse<T extends AnyRPCClient, K extends (keyof T) & string> = {
	type: `${K}Done`
	response: Awaited<ReturnType<T[K]>>
}

export type RPCErrorResponse = {
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
	RPCRequest<RPCWitnessClient, 'createClaim'>
	| RPCRequest<RPCWitnessClient, 'extractHtmlElement'>
	| RPCRequest<RPCWitnessClient, 'extractJSONValueIndex'>
	| RPCRequest<RPCWitnessClient, 'getCurrentMemoryUsage'>
	| AsResponse<RPCResponse<RPCAppClient, 'zkProve'>>
	| AsResponse<RPCResponse<RPCAppClient, 'zkVerify'>>
	| AsResponse<RPCErrorResponse>
) & IdentifiedMessage

/**
 * Data sent back from the witness to
 * the window/application containing the witness
 */
export type WindowRPCOutgoingMsg = (
	AsResponse<RPCResponse<RPCWitnessClient, 'createClaim'>>
	| AsResponse<RPCResponse<RPCWitnessClient, 'extractHtmlElement'>>
	| AsResponse<RPCResponse<RPCWitnessClient, 'extractJSONValueIndex'>>
	| AsResponse<RPCResponse<RPCWitnessClient, 'getCurrentMemoryUsage'>>
	| RPCRequest<RPCAppClient, 'zkProve'>
	| RPCRequest<RPCAppClient, 'zkVerify'>
	| (
		{
			type: 'createClaimStep'
			step: CreateStep
		}
	)
	| AsResponse<RPCErrorResponse>
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