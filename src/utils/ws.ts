import type { WebSocket as WSWebSocket } from 'ws'

export function makeWebSocket(url: string) {
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