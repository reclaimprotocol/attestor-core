import { RPCHandler } from 'src/types'

export const disconnectTunnel: RPCHandler<'disconnectTunnel'> = async(
	{ id },
	{ client }
) => {
	const tunnel = client.getTunnel(id)
	await tunnel.close()

	return {}
}