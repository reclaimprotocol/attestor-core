import type { IncomingMessage } from 'http'
import { createServer as createHttpServer } from 'http'
import serveStatic from 'serve-static'
import { API_SERVER_PORT, BROWSER_RPC_PATHNAME, WS_PATHNAME } from 'src/config/index.ts'
import { AttestorServerSocket } from 'src/server/socket.ts'
import { getAttestorAddress } from 'src/server/utils/generics.ts'
import { addKeepAlive } from 'src/server/utils/keep-alive.ts'
import type { BGPListener } from 'src/types/index.ts'
import { createBgpListener } from 'src/utils/bgp-listener.ts'
import { getEnvVariable } from 'src/utils/env.ts'
import { logger as LOGGER } from 'src/utils/index.ts'
import { SelectedServiceSignatureType } from 'src/utils/signatures/index.ts'
import { promisifySend } from 'src/utils/ws.ts'
import type { Duplex } from 'stream'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'

const PORT = +(getEnvVariable('PORT') || API_SERVER_PORT)
const DISABLE_BGP_CHECKS = getEnvVariable('DISABLE_BGP_CHECKS') === '1'

/**
 * Creates the WebSocket API server,
 * creates a fileserver to serve the browser RPC client,
 * and listens on the given port.
 */
export async function createServer(port = PORT) {
	const http = createHttpServer()
	const serveBrowserRpc = serveStatic(
		'browser',
		{
			index: ['index.html'],
			setHeaders(res) {
				res.setHeader('Access-Control-Allow-Origin', '*')
			},
		}
	)
	const bgpListener = !DISABLE_BGP_CHECKS
		? createBgpListener(LOGGER.child({ service: 'bgp-listener' }))
		: undefined

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

	wss.on('connection', (ws, req) => handleNewClient(ws, req, bgpListener))

	LOGGER.info(
		{
			port,
			apiPath: WS_PATHNAME,
			browserRpcPath: BROWSER_RPC_PATHNAME,
			signerAddress: getAttestorAddress(SelectedServiceSignatureType)
		},
		'WS server listening'
	)

	const wssClose = wss.close.bind(wss)
	wss.close = (cb) => {
		wssClose(() => http.close(cb))
		bgpListener?.close()
	}

	return wss
}

async function handleNewClient(
	ws: WebSocket,
	req: IncomingMessage,
	bgpListener: BGPListener | undefined
) {
	promisifySend(ws)
	const client = await AttestorServerSocket.acceptConnection(
		ws,
		{ req, bgpListener, logger: LOGGER }
	)
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