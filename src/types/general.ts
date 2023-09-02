import type { Logger as TLSLogger } from '@reclaimprotocol/tls'

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