import { URL as WHATWG_URL } from 'whatwg-url'

import { CloseEventPolyfill, ErrorEventPolyfill, EventPolyfill, MessageEventPolyfill } from '#src/external-rpc/jsc-polyfills/event.ts'
import { RPCWebSocket } from '#src/external-rpc/jsc-polyfills/ws.ts'

if(typeof globalThis.URL === 'undefined') {
	globalThis.URL = WHATWG_URL
}

if(typeof globalThis.Event === 'undefined') {
	// @ts-expect-error
	globalThis.Event = EventPolyfill
	// @ts-expect-error
	globalThis.ErrorEvent = ErrorEventPolyfill
	// @ts-expect-error
	globalThis.CloseEvent = CloseEventPolyfill
	// @ts-expect-error
	globalThis.MessageEvent = MessageEventPolyfill
}

if(typeof globalThis.WebSocket === 'undefined') {
	// @ts-expect-error
	globalThis.WebSocket = RPCWebSocket
}