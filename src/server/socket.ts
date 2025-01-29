import { handleMessage } from 'src/client/utils/message-handler'
import { TunnelMessage } from 'src/proto/api'
import { HANDLERS } from 'src/server/handlers'
import { getApm } from 'src/server/utils/apm'
import { getInitialMessagesFromQuery } from 'src/server/utils/generics'
import { AcceptNewConnectionOpts, BGPListener, IAttestorServerSocket, Logger, RPCEvent, RPCHandler } from 'src/types'
import { AttestorError, generateSessionId } from 'src/utils'
import { AttestorSocket } from 'src/utils/socket-base'
import { promisify } from 'util'
import { WebSocket as WS } from 'ws'

export class AttestorServerSocket extends AttestorSocket implements IAttestorServerSocket {

	tunnels: IAttestorServerSocket['tunnels'] = {}

	private constructor(
		socket: WS,
		public sessionId: number,
		public bgpListener: BGPListener | undefined,
		logger: Logger
	) {
		// @ts-ignore
		super(socket, {}, logger)
		// handle RPC requests
		this.addEventListener('rpc-request', handleRpcRequest.bind(this))
		// forward packets to the appropriate tunnel
		this.addEventListener('tunnel-message', handleTunnelMessage.bind(this))
		// close all tunnels when the connection is terminated
		// since this tunnel can no longer be written to
		this.addEventListener('connection-terminated', () => {
			for(const tunnelId in this.tunnels) {
				const tunnel = this.tunnels[tunnelId]
				void tunnel.close(new Error('WS session terminated'))
			}
		})
	}

	getTunnel(tunnelId: number) {
		const tunnel = this.tunnels[tunnelId]
		if(!tunnel) {
			throw new AttestorError(
				'ERROR_NOT_FOUND',
				`Tunnel "${tunnelId}" not found`
			)
		}

		return tunnel
	}

	removeTunnel(tunnelId: TunnelMessage['tunnelId']): void {
		delete this.tunnels[tunnelId]
	}

	static async acceptConnection(
		socket: WS,
		{ req, logger, bgpListener }: AcceptNewConnectionOpts
	) {
		// promisify ws.send -- so the sendMessage method correctly
		// awaits the send operation
		const bindSend = socket.send.bind(socket)
		socket.send = promisify(bindSend)

		const sessionId = generateSessionId()
		logger = logger.child({ sessionId })

		const client = new AttestorServerSocket(
			socket, sessionId, bgpListener, logger
		)
		try {
			const initMsgs = getInitialMessagesFromQuery(req)
			logger.trace(
				{ initMsgs: initMsgs.length },
				'new connection, validating...'
			)
			for(const msg of initMsgs) {
				await handleMessage.call(client, msg)
			}

			logger.debug('connection accepted')
		} catch(err) {
			logger.error({ err }, 'error in new connection')
			if(client.isOpen) {
				await client.terminateConnection(
					err instanceof AttestorError
						? err
						: AttestorError.badRequest(err.message)
				)
			}

			return
		}

		return client
	}
}

async function handleTunnelMessage(
	this: IAttestorServerSocket,
	{ data: { tunnelId, message } }: RPCEvent<'tunnel-message'>
) {
	try {
		const tunnel = this.getTunnel(tunnelId)
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
	this: IAttestorServerSocket,
	{ data: { data, requestId, respond, type } }: RPCEvent<'rpc-request'>
) {
	const logger = this.logger.child({
		rpc: type,
		requestId
	})

	const apm = getApm()
	const tx = apm?.startTransaction(type)
	tx?.setLabel('requestId', requestId)
	tx?.setLabel('sessionId', this.sessionId.toString())

	const userId = this.metadata.auth?.data?.id
	if(userId) {
		tx?.setLabel('authUserId', userId)
	}

	try {
		logger.debug({ data }, 'handling RPC request')

		const handler = HANDLERS[type] as RPCHandler<typeof type>
		const res = await handler(data, { client: this, logger, tx })
		respond(res)

		logger.debug({ res }, 'handled RPC request')
		tx?.setOutcome('success')
	} catch(err) {
		logger.error({ err }, 'error in RPC request')
		respond(AttestorError.fromError(err))
		tx?.setOutcome('failure')

		apm?.captureError(err, { parent: tx })
	} finally {
		tx?.end()
	}
}