import type { Logger as TLSLogger, TLSPacketContext, TLSProtocolVersion } from '@reclaimprotocol/tls'

import type { TOPRFProofParams } from '#src/types/zk.ts'

/**
 * Represents a slice of any array or string
 */
export type ArraySlice = {
	fromIndex: number
	toIndex: number
}

export type RedactedOrHashedArraySlice = {
	fromIndex: number
	toIndex: number
	/**
	 * By default, the the data is redacted. Instead if you'd like
	 * a deterministic hash, set this to 'oprf'
	 * @default undefined
	 */
	hash?: 'oprf'
}

export type Logger = TLSLogger & {
	child: (opts: { [_: string]: any }) => Logger
}

export type LogLevel = 'debug' | 'info'
	| 'warn' | 'error'
	| 'trace' | 'fatal'

export type ZKRevealInfo = {
	type: 'zk'
	redactedPlaintext: Uint8Array
	toprfs?: TOPRFProofParams[]
	overshotToprfFromPrevBlock?: { length: number }
}

export type MessageRevealInfo = { type: 'complete' } | ZKRevealInfo

export type CompleteTLSPacket = TLSPacketContext
	& {
		/**
		 * Full data that was sent/recv across the wire
		 */
		data: Uint8Array
	}

export type IDecryptedTranscriptMessage = {
	sender: 'client' | 'server'
	redacted: boolean
	message: Uint8Array
	plaintextLength: number
	recordHeader: Uint8Array
}

export type IDecryptedTranscript = {
	transcript: IDecryptedTranscriptMessage[]
	tlsVersion: TLSProtocolVersion
	hostname: string
}