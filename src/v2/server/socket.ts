import { IncomingMessage } from 'http'
import { promisify } from 'util'
import { WebSocket as WS } from 'ws'
import { InitRequest } from '../../proto/api'
import { SIGNATURES } from '../../signatures'
import { Logger } from '../../types'
import { WitnessError } from '../../utils'
import { WitnessSocket } from '../client/socket'
import { IWitnessServerSocket, RPCEvent } from '../types'
import { generateSessionId } from '../utils/generics'
import { HANDLERS } from './handlers'

export class WitnessServerSocket extends WitnessSocket implements IWitnessServerSocket {

	tunnels: IWitnessServerSocket['tunnels'] = {}

	constructor(socket: WS, req: IncomingMessage, logger: Logger) {
		// promisify ws.send -- so the sendMessage method correctly
		// awaits the send operation
		const bindSend = socket.send.bind(socket)
		socket.send = promisify(bindSend)

		const sessionId = generateSessionId()
		logger = logger.child({ sessionId })

		logger.trace('new connection, validating...')

		super(
			socket as unknown as WebSocket,
			{} as InitRequest,
			logger
		)

		try {
			this.metadata = validateConnection(req)
			logger.debug(
				{ metadata: this.metadata },
				'validated connection'
			)
		} catch(err) {
			logger.warn({ err }, 'failed to validate connection')
			this.terminateConnection(
				err instanceof WitnessError
					? err
					: WitnessError.badRequest(err.message)
			)
			return
		}

		this.isInitialised = true
		this.sendMessage({ initResponse: {} })

		// handle RPC requests
		this.addEventListener('rpc-request', handleRpcRequest.bind(this))
		// forward packets to the appropriate tunnel
		this.addEventListener('tunnel-message', handleTunnelMessage.bind(this))
		// close all tunnels when the connection is terminated
		// since this tunnel can no longer be written to
		this.addEventListener('connection-terminated', () => {
			for(const tunnelId in this.tunnels) {
				const tunnel = this.tunnels[tunnelId]
				tunnel.close(new Error('WS session terminated'))
			}
		})
	}

	getTunnel(tunnelId: number) {
		const tunnel = this.tunnels[tunnelId]
		if(!tunnel) {
			throw new WitnessError(
				'WITNESS_ERROR_NOT_FOUND',
				`Tunnel "${tunnelId}" not found`
			)
		}

		return tunnel
	}
}

function validateConnection(req: IncomingMessage) {
	const url = new URL(req.url!, 'http://localhost')
	const initRequestB64 = url.searchParams.get('initRequest')
	if(!initRequestB64) {
		throw WitnessError.badRequest('initRequest is required')
	}

	const initRequestBytes = Buffer.from(initRequestB64, 'base64')
	const initRequest = InitRequest.decode(initRequestBytes)
	if(!SIGNATURES[initRequest.signatureType]) {
		throw WitnessError.badRequest('Unsupported signature type')
	}

	if(initRequest.clientVersion <= 0) {
		throw WitnessError.badRequest('Unsupported client version')
	}

	return initRequest
}

async function handleTunnelMessage(
	this: IWitnessServerSocket,
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
	this: IWitnessServerSocket,
	{ data: { data, requestId, respond, type } }: RPCEvent<'rpc-request'>
) {
	const logger = this.logger.child({
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