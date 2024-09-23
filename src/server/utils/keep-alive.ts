import { Logger } from 'pino'
import { MAX_NO_DATA_INTERVAL_MS, PING_INTERVAL_MS } from 'src/config'
import { WebSocket } from 'ws'

/**
 * Adds a keep-alive mechanism to the WebSocket
 * client
 */
export function addKeepAlive(ws: WebSocket, logger: Logger) {
	let sendTimeout: NodeJS.Timeout
	let killTimeout: NodeJS.Timeout

	ws.on('message', () => {
		logger.trace('data recv, resetting timer')
		resetTimer()
	})
	ws.on('pong', () => {
		logger.trace('pong received, resetting timer')
		resetTimer()
	})

	ws.on('error', cleanup)
	ws.on('close', cleanup)

	function resetTimer() {
		cleanup()
		resetSendTimeout()

		killTimeout = setTimeout(() => {
			logger.warn(
				'no data received in a while, closing connection'
			)
			ws.close()
		}, MAX_NO_DATA_INTERVAL_MS)
	}

	function resetSendTimeout() {
		// reset ping
		sendTimeout = setTimeout(() => {
			ws.ping()
			resetSendTimeout()
		}, PING_INTERVAL_MS)
	}

	function cleanup() {
		clearTimeout(killTimeout)
		clearTimeout(sendTimeout)
	}
}