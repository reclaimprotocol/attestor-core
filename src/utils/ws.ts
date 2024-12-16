import { MAX_PAYLOAD_SIZE } from 'src/config'
import { detectEnvironment } from 'src/utils/env'

/**
 * Default WebSocket implementation, uses `ws` package
 * for Node.js and the native WebSocket for the browser & other
 * environments.
 */
export function makeWebSocket(url: string) {
	if(detectEnvironment() === 'node') {
		const ws = require('ws') as typeof import('ws')
		return new ws.WebSocket(url, { maxPayload: MAX_PAYLOAD_SIZE })
	}

	return new WebSocket(url)
}