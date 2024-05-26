import { IncomingMessage } from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import { API_SERVER_PORT } from '../config'
import { logger as LOGGER } from '../utils'
import { WitnessServerSocket } from './socket'

/**
 * Creates the WebSocket server and listens on the given port.
 */
export async function makeWsServer(port = API_SERVER_PORT) {
	const wss = new WebSocketServer({ port })
	// wait for us to start listening
	await new Promise<void>((resolve, reject) => {
		wss.once('listening', () => resolve())
		wss.once('error', reject)
	})

	wss.on('connection', handleNewClient)

	LOGGER.info({ port }, 'WS server listening')

	return wss
}

async function handleNewClient(ws: WebSocket, req: IncomingMessage) {
	const client = await WitnessServerSocket
		.acceptConnection(ws, req, LOGGER)
	// if initialisation fails, don't store the client
	if(!client) {
		return
	}

	ws.serverSocket = client
}