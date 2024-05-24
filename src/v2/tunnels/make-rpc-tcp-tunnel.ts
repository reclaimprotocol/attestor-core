import { CreateTunnelRequest } from '../../proto/api'
import { logger as LOGGER } from '../../utils/logger'
import { MakeTunnelFn, RPCEvent } from '../types'
import { generateRpcMessageId } from '../utils/generics'

type ExtraOpts = {
	request: Partial<CreateTunnelRequest>
	client: WebSocket
}

/**
 * Makes a TCP tunnel to a remote server using the RPC protocol.
 */
export const makeRpcTcpTunnel: MakeTunnelFn<Uint8Array, ExtraOpts> = async({
	request,
	logger = LOGGER.child({ tunnel: request.host }),
	client,
	onClose,
	onMessage,
}) => {
	logger.trace('creating tunnel')

	const tunnelId = (request.id ||= generateRpcMessageId())

	client.addEventListener('tunnel-message', onMessageListener)

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
}