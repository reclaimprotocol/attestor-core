import type { RPCHandler } from '#src/types/index.ts'

export const disconnectTunnel: RPCHandler<'disconnectTunnel'> = async(
	{ id },
	{ client }
) => {
	const tunnel = client.getTunnel(id)
	await tunnel.close()

	return {}
}