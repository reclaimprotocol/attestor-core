import type { Logger as TLSLogger, TLSPacket, TLSPacketContext } from '@reclaimprotocol/tls'
import { TranscriptMessageSenderType } from '../proto/api'

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

export type CompleteTLSPacket = {
	packet: TLSPacket
	ctx: TLSPacketContext
	sender: TranscriptMessageSenderType
	/** Index of packet recv from server */
	index: number
	reveal?: { type: 'complete' }
		| {
			type: 'zk'
			redactedPlaintext: Uint8Array
		}
}
