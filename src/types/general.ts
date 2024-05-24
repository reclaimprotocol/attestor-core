import type { Logger as TLSLogger, TLSPacketContext } from '@reclaimprotocol/tls'

/**
 * Represents a slice of any array or string
 */
export type ArraySlice = {
	fromIndex: number
	toIndex: number
}

export type Logger = TLSLogger & {
	child: (opts: { [_: string]: any }) => Logger
}

export type ZKRevealInfo = {
	type: 'zk'
	redactedPlaintext: Uint8Array
}

export type MessageRevealInfo = { type: 'complete' } | ZKRevealInfo

export type CompleteTLSPacket = Exclude<TLSPacketContext, { type: 'plaintext' }>
	| {
		type: 'plaintext'
		plaintext: Uint8Array
	}