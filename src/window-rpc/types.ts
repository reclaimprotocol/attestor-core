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

/**
 * Data sent to the witness from the window/application
 */
export type WindowRPCIncomingMsg = ({
	type: 'createClaim'
	request: RPCCreateClaimOptions
} | {
	type: 'extractHtmlElement'
	request: {
		html: string
		xpathExpression: string
		contentsOnly: boolean
	}
} | {
	type: 'extractJSONValueIndex'
	request: {
		json: string
		jsonPath: string
	}
} | {
	type: 'getCurrentMemoryUsage'
	request: undefined
} | {
	type: 'zkProveDone'
	requestId: string
	result: {
		output: Awaited<ReturnType<ZKOperator['groth16FullProve']>>
	} | {
		error: string
	}
} | {
	type: 'zkVerifyDone'
	requestId: string
	result: {
		output: Awaited<ReturnType<ZKOperator['groth16Verify']>>
	} | {
		error: string
	}
}
) & IdentifiedMessage

/**
 * Data sent back from the witness to
 * the window/application containing the witness
 */
export type WindowRPCOutgoingMsg = {
	type: 'createClaimDone'
	response: Awaited<ReturnType<typeof createClaim>>
} | {
	type: 'createClaimStep'
	step: CreateStep
} | {
	type: 'extractHtmlElementDone'
	response: ReturnType<typeof extractHTMLElement>
} | {
	type: 'extractJSONValueIndexDone'
	response: ReturnType<typeof extractJSONValueIndex>
} | {
	type: 'getCurrentMemoryUsageDone'
	response: {
		available: boolean
		content: string
	}
} | {
	type: 'error'
	data: {
		message: string
		stack?: string
	}
} | {
	type: 'zkProve'
	requestId: string
	isResponse: true
	data: {
		algorithm: EncryptionAlgorithm
		input: { [_: string]: any }
	}
} | {
	type: 'zkVerify'
	requestId: string
	isResponse: true
	data: {
		algorithm: EncryptionAlgorithm
		publicSignals: number[]
		proof: { [_: string]: any }
	}
}

/**
 * Response served
 */
export type WindowRPCResponse = WindowRPCOutgoingMsg
	& IdentifiedMessage
	& { isResponse: true }

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