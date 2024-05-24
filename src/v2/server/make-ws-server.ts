import { IncomingMessage } from 'http'
import { promisify } from 'util'
import ws, { WebSocketServer } from 'ws'
import { extendWsPrototype, proto } from '../../'
import { API_SERVER_PORT } from '../../config'
import { SIGNATURES } from '../../signatures'
import { logger as LOGGER, WitnessError } from '../../utils'
import { RPCEvent } from '../types'
import { generateSessionId } from '../utils/generics'
import { HANDLERS } from './handlers'

// fix the WS prototype
fixWsWebsocket()

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

function handleNewClient(ws: WebSocket, req: IncomingMessage) {
	const sessionId = generateSessionId()
	const logger = LOGGER.child({ sessionId })
	ws.logger = logger
	ws.binaryType = 'arraybuffer'

	// promisify ws.send -- so the sendMessage method correctly
	// awaits the send operation
	const bindSend = ws.send.bind(ws)
	ws.send = promisify(bindSend)

	logger.trace('new connection, validating...')

	try {
		ws.metadata = validateConnection(req)
		logger.debug({ metadata: ws.metadata }, 'validated connection')
	} catch(err) {
		logger.warn({ err }, 'failed to validate connection')
		ws.terminateConnection(
			err instanceof WitnessError
				? err
				: WitnessError.badRequest(err.message)
		)
		return
	}

	ws.initialised = true
	ws.tunnels = {}
	ws.sendMessage({ initResponse: {} })
	ws.startProcessingRpcMessages()

	// handle RPC requests
	ws.addEventListener('rpc-request', handleRpcRequest.bind(ws))
	// forward packets to the appropriate tunnel
	ws.addEventListener('tunnel-message', handleTunnelMessage.bind(ws))
	// close all tunnels when the connection is terminated
	// since this tunnel can no longer be written to
	ws.addEventListener('connection-terminated', () => {
		for(const tunnelId in ws.tunnels) {
			const tunnel = ws.tunnels[tunnelId]
			tunnel.close(new Error('WS session terminated'))
		}
	})
}

function validateConnection(req: IncomingMessage) {
	const url = new URL(req.url!, 'http://localhost')
	const initRequestB64 = url.searchParams.get('initRequest')
	if(!initRequestB64) {
		throw WitnessError.badRequest('initRequest is required')
	}

	const initRequestBytes = Buffer.from(initRequestB64, 'base64')
	const initRequest = proto.InitRequest.decode(initRequestBytes)
	if(!SIGNATURES[initRequest.signatureType]) {
		throw WitnessError.badRequest('Unsupported signature type')
	}

	if(initRequest.clientVersion <= 0) {
		throw WitnessError.badRequest('Unsupported client version')
	}

	return initRequest
}

async function handleTunnelMessage(
	this: WebSocket,
	{ data: { tunnelId, message } }: RPCEvent<'tunnel-message'>
) {
	const tunnel = this.tunnels[tunnelId]
	if(!tunnel) {
		this.logger?.warn({ tunnelId }, 'tunnel not found')
		return
	}

	try {
		await tunnel.write(message)
	} catch(err) {
		this.logger?.error(
			{
				err,
				tunnelId,
			},
			'error writing to tunnel'
		)
	}
}

async function handleRpcRequest(
	this: WebSocket,
	{ data: { data, requestId, respond, type } }: RPCEvent<'rpc-request'>
) {
	const logger = this.logger!.child({
		rpc: type,
		requestId
	})
	try {
		logger.debug({ data }, 'handling RPC request')

		const handler = HANDLERS[type]
		const res = await handler(
			data as any,
			{
				client: this,
				logger,
			}
		)
		respond(res)

		logger.debug({ res }, 'handled RPC request')
	} catch(err) {
		logger.error({ err }, 'error in RPC request')
		respond(WitnessError.fromError(err))
	}
}

function fixWsWebsocket() {
	// the ws WebSocket has some logic that unintentionally
	// prevents listeners of events that are not 'open', 'close',
	// 'error', or 'message' from being added to the WebSocket.
	// This patch allows us to add listeners to any event type
	const addEventListener = ws.WebSocket.prototype.addEventListener
	ws.WebSocket.prototype.addEventListener = function(type, ...args: any[]) {
		if(
			type === 'open' || type === 'close'
			|| type === 'error' || type === 'message'
		) {
			addEventListener.call(this, type, ...args)
			return
		}

		this.on(type, args[0])
	}

	// of course add our RPC message handling logic
	// @ts-expect-error
	extendWsPrototype(ws.WebSocket)
}