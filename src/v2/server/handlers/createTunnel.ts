import { WitnessError } from '../../../utils'
import { RPCHandler } from '../../types'
import { makeTcpTunnel } from '../tunnels/make-socket-tunnel'
import { getApm } from '../utils/apm'

export const createTunnel: RPCHandler<'createTunnel'> = async(
	{ id, initialMessage, ...opts },
	{ tx, logger, client }
) => {
	const apm = getApm()
	const sessionTx = apm.startTransaction(
		'tunnel',
		{ childOf: tx }
	) || undefined
	sessionTx.addLabels({ tunnelId: id, ...opts })

	if(client.tunnels[id]) {
		throw WitnessError.badRequest(`Tunnel "${id}" already exists`)
	}

	try {
		const tunnel = await makeTcpTunnel({
			...opts,
			logger,
			onMessage(message) {
				if(!client.isOpen) {
					logger.warn('client is closed, dropping message')
					return
				}

				client.sendMessage({
					tunnelMessage: {
						tunnelId: id,
						message
					}
				})
			},
			onClose(err) {
				if(err) {
					apm.captureError(err, { parent: sessionTx })
					tx?.setOutcome('failure')
				}

				tx?.end()

				client.sendMessage({
					tunnelDisconnectEvent: {
						tunnelId: id,
						error: err
							? WitnessError
								.fromError(err)
								.toProto()
							: undefined
					}
				})
			},
		})

		client.tunnels[id] = tunnel

		if(initialMessage?.length) {
			await tunnel.write(initialMessage)
		}

		return {}
	} catch(err) {
		apm.captureError(err, { parent: sessionTx })
		tx?.setOutcome('failure')
		tx?.end()

		throw err
	}
}