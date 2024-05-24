import { CreateTunnelRequest } from '../../proto/api'
import { WitnessError } from '../../utils'
import { logger as LOGGER } from '../../utils/logger'
import { MakeTunnelFn, RPCEvent } from '../types'
import { generateRpcMessageId } from '../utils/generics'

type ExtraOpts = {
	request: Partial<CreateTunnelRequest>
	client: WebSocket
}

/**
 * Makes a TCP tunnel to a remote server using the RPC protocol,
 * with the witness server acting as a proxy.
 */
export const makeRpcTcpTunnel: MakeTunnelFn<ExtraOpts> = async({
	request,
	logger = LOGGER.child({ tunnel: request.host }),
	client,
	onClose,
	onMessage,
}) => {
	logger.trace('creating tunnel')

	const tunnelId = (request.id ||= generateRpcMessageId())

	client.addEventListener('tunnel-message', onMessageListener)
	client.addEventListener('tunnel-disconnect-event', onDisconnectListener)

	await client.rpc('createTunnel', request)
	logger.trace('tunnel created')

	return {
		write(message) {
			return client.sendMessage({
				tunnelMessage: { tunnelId, message }
			})
		},
		async close(err) {
			client.removeEventListener('tls-message', onMessageListener)
			await client.rpc('disconnectTunnel', { id: tunnelId })
			onClose?.(err)
		}
	}

	function onMessageListener({ data }: RPCEvent<'tunnel-message'>) {
		if(data.tunnelId !== tunnelId) {
			return
		}

		onMessage?.(data.message)
	}

	function onDisconnectListener({ data }: RPCEvent<'tunnel-disconnect-event'>) {
		if(data.tunnelId !== tunnelId) {
			return
		}

		client.removeEventListener('tunnel-message', onMessageListener)
		client.removeEventListener('tunnel-disconnect-event', onDisconnectListener)
		onClose?.(
			data.error
				? WitnessError.fromProto(data.error)
				: undefined
		)
	}
}