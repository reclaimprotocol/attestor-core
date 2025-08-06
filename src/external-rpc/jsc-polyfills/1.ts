import { TextDecoder, TextEncoder } from '@kayahr/text-encoding'
import { crypto } from '@reclaimprotocol/tls'
import { EventTarget } from 'event-target-shim'

import type { WindowRPCIncomingMsg, WindowRPCOutgoingMsg } from '#src/external-rpc/types.ts'

declare global {
	function readline(): string
	function print(...args: any[]): void
	function debug(...args: any[]): void
	function quit(): void

	type JSCIncomingMsg = WindowRPCIncomingMsg
		| { type: 'quit' }
		| {
			type: 'init'
			attestorBaseUrl: string
		}

	type JSCOutgoingMsg = WindowRPCOutgoingMsg
}

if(typeof global === 'undefined') {
	globalThis.global = globalThis
}

if(typeof console === 'undefined') {
	// @ts-expect-error
	globalThis.console = {
		log: print,
		error: print,
		warn: print,
		info: print,
		debug: print,
	}
}

if(typeof globalThis.crypto === 'undefined') {
	globalThis.crypto = {
		// @ts-expect-error
		getRandomValues(arr: Uint8Array) {
			const randVals = crypto.randomBytes(arr.length)
			for(let i = 0; i < arr.length; i++) {
				arr[i] = randVals[i]
			}

			return arr
		},
		randomBytes(length: number) {
			return crypto.randomBytes(length)
		}
	}
}

if(typeof globalThis.TextEncoder === 'undefined') {
	globalThis.TextEncoder = TextEncoder
}

if(typeof globalThis.TextDecoder === 'undefined') {
	globalThis.TextDecoder = TextDecoder
}

if(typeof globalThis.EventTarget === 'undefined') {
	globalThis.EventTarget = EventTarget
}

if(typeof globalThis.clearTimeout === 'undefined') {
	const ogSettimeout = globalThis.setTimeout
	// @ts-expect-error
	globalThis.setTimeout = (fn, delayMs, ...args) => {
		let aborted = false
		const abortableFn = (...args) => {
			if(aborted) {
				return
			}

			return fn(...args)
		}

		const val = ogSettimeout(abortableFn, delayMs, ...args)
		return {
			original: val,
			abort() {
				aborted = true
			}
		}
	}

	globalThis.clearTimeout = (id) => {
		if(typeof id === 'object' && !!id && 'abort' in id) {
			id.abort()
		}
	}
}