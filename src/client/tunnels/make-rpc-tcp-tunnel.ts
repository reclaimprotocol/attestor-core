import { CreateTunnelRequest } from 'src/proto/api'
import { IAttestorClient, MakeTunnelFn, RPCEvent } from 'src/types'
import { AttestorError } from 'src/utils'

export type TCPTunnelCreateOpts = {
	/**
	 * The tunnel ID to communicate with.
	 */
	tunnelId: CreateTunnelRequest['id']
	client: IAttestorClient
}

/**
 * Makes a tunnel communication wrapper for a TCP tunnel.
 *
 * It listens for messages and disconnect events from the server,
 * and appropriately calls the `onMessage` and `onClose` callbacks.
 */
export const makeRpcTcpTunnel: MakeTunnelFn<TCPTunnelCreateOpts> = ({
	tunnelId,
	client,
	onClose,
	onMessage,
}) => {
	let closed = false
	client.addEventListener('tunnel-message', onMessageListener)
	client.addEventListener('tunnel-disconnect-event', onDisconnectListener)
	client.addEventListener('connection-terminated', onConnectionTerminatedListener)

	return {
		async write(message) {
			await client.sendMessage({
				tunnelMessage: { tunnelId, message }
			})
		},
		async close(err) {
			if(closed) {
				return
			}

			onErrorRecv(err)
			await client.rpc('disconnectTunnel', { id: tunnelId })
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

		onErrorRecv(
			data.error?.code
				? AttestorError.fromProto(data.error)
				: undefined
		)
	}

	function onConnectionTerminatedListener({ data }: RPCEvent<'connection-terminated'>) {
		onErrorRecv(data)
	}

	function onErrorRecv(err: Error | undefined) {
		client.logger?.debug({ tunnelId, err }, 'TCP tunnel closed')

		client.removeEventListener('tunnel-message', onMessageListener)
		client.removeEventListener('tunnel-disconnect-event', onDisconnectListener)
		client.removeEventListener('connection-terminated', onConnectionTerminatedListener)
		onClose?.(err)
		onClose = undefined
		closed = true
	}
}