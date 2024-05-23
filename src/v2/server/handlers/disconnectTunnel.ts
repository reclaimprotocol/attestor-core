import { WitnessError } from '../../../utils'
import { RPCHandler } from '../../types'

export const disconnectTunnel: RPCHandler<'disconnectTunnelRequest'> = async(
	{ id },
	{ client }
) => {
	const tunnel = client.tunnels[id]
	if(!tunnel) {
		throw new WitnessError(
			'WITNESS_ERROR_NOT_FOUND',
			`Tunnel "${id}" not found`
		)
	}

	tunnel?.close(new Error('Tunnel disconnected'))

	return {}
}