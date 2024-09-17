import { AnyWebSocketConstructor } from 'src/types'
import { detectEnvironment } from 'src/utils/env'

/**
 * Default WebSocket implementation, uses `ws` package
 * for Node.js and the native WebSocket for the browser & other
 * environments.
 */
export let Websocket: AnyWebSocketConstructor = (
	detectEnvironment() === 'node'
		? require('ws').WebSocket
		: WebSocket
)

/**
 * Replace the default WebSocket implementation utilised
 * by the Attestor client.
 */
export function setWebsocket(ws: AnyWebSocketConstructor) {
	Websocket = ws
}