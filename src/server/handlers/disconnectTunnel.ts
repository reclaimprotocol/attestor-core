import { RPCHandler } from '../../types'

export const disconnectTunnel: RPCHandler<'disconnectTunnel'> = async(
	{ id },
	{ client }
) => {
	const tunnel = client.getTunnel(id)
	await tunnel.close(new Error('Tunnel disconnected'))

	return {}
}