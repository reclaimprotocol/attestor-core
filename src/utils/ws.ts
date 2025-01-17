import { MAX_PAYLOAD_SIZE } from 'src/config'
import { detectEnvironment } from 'src/utils/env'
import type { WebSocket as WSWebSocket } from 'ws'

/**
 * Default WebSocket implementation, uses `ws` package
 * for Node.js and the native WebSocket for the browser & other
 * environments.
 */
export function makeWebSocket(url: string) {
	if(detectEnvironment() === 'node') {
		const ws = require('ws') as typeof import('ws')
		return promisifySend(
			new ws.WebSocket(url, { maxPayload: MAX_PAYLOAD_SIZE })
		)
	}

	return new WebSocket(url)
}

/**
 * Adds the "sendPromise" fn to the given WebSocket instance,
 * if not already present.
 */
export function promisifySend(ws: WSWebSocket) {
	if(ws.sendPromise) {
		return ws
	}

	ws.sendPromise = (data) => (
		new Promise((resolve, reject) => {
			ws.send(data, err => {
				if(err) {
					reject(err)
					return
				}

				resolve()
			})
		})
	)

	return ws
}