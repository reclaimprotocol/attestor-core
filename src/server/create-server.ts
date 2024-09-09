import { createServer as createHttpServer, IncomingMessage } from 'http'
import serveStatic from 'serve-static'
import type { Duplex } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import { API_SERVER_PORT, BROWSER_RPC_PATHNAME, WS_PATHNAME } from '../config'
import { ServiceSignatureType } from '../proto/api'
import { logger as LOGGER } from '../utils'
import { getEnvVariable } from '../utils/env'
import { getWitnessAddress } from './utils/generics'
import { addKeepAlive } from './utils/keep-alive'
import { WitnessServerSocket } from './socket'

const PORT = +(getEnvVariable('PORT') || API_SERVER_PORT)

/**
 * Creates the WebSocket API server,
 * creates a fileserver to serve the browser RPC client,
 * and listens on the given port.
 */
export async function createServer(port = PORT) {
	const http = createHttpServer()
	const serveBrowserRpc = serveStatic(
		'browser',
		{ index: ['index.html'] }
	)

	const wss = new WebSocketServer({ noServer: true })
	http.on('upgrade', handleUpgrade.bind(wss))
	http.on('request', (req, res) => {
		// simple way to serve files at the browser RPC path
		if(!req.url?.startsWith(BROWSER_RPC_PATHNAME)) {
			res.statusCode = 404
			res.end('Not found')
			return
		}

		req.url = req.url.slice(BROWSER_RPC_PATHNAME.length) || '/'

		serveBrowserRpc(req, res, (err) => {
			if(err) {
				LOGGER.error(
					{ err, url: req.url },
					'Failed to serve file'
				)
			}

			res.statusCode = err?.statusCode ?? 404
			res.end(err?.message ?? 'Not found')
		})
	})

	// wait for us to start listening
	http.listen(port)
	await new Promise<void>((resolve, reject) => {
		http.once('listening', () => resolve())
		http.once('error', reject)
	})

	wss.on('connection', handleNewClient)

	LOGGER.info(
		{
			port,
			apiPath: WS_PATHNAME,
			browserRpcPath: BROWSER_RPC_PATHNAME,
			signerAddress: getWitnessAddress(
				ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH
			)
		},
		'WS server listening'
	)

	const wssClose = wss.close.bind(wss)
	wss.close = (cb) => {
		wssClose(() => http.close(cb))
	}

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
	addKeepAlive(ws, LOGGER.child({ sessionId: client.sessionId }))
}

function handleUpgrade(
	this: WebSocketServer,
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer
) {
	const { pathname } = new URL(request.url!, 'wss://base.url')

	if(pathname === WS_PATHNAME) {
		this.handleUpgrade(request, socket, head, (ws) => {
			this.emit('connection', ws, request)
		})
		return
	}

	socket.destroy()
}