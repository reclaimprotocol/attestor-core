import { makeTcpTunnel } from 'src/server/tunnels/make-tcp-tunnel'
import { getApm } from 'src/server/utils/apm'
import { RPCHandler } from 'src/types'
import { AttestorError } from 'src/utils'

export const createTunnel: RPCHandler<'createTunnel'> = async(
	{ id, ...opts },
	{ tx, logger, client }
) => {
	const apm = getApm()
	const sessionTx = apm?.startTransaction(
		'tunnel',
		{ childOf: tx }
	) || undefined
	sessionTx?.addLabels({ tunnelId: id, ...opts })

	if(client.tunnels[id]) {
		throw AttestorError.badRequest(`Tunnel "${id}" already exists`)
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
					apm?.captureError(err, { parent: sessionTx })
					tx?.setOutcome('failure')
				}

				tx?.end()

				if(!client.isOpen) {
					return
				}

				client.sendMessage({
					tunnelDisconnectEvent: {
						tunnelId: id,
						error: err
							? AttestorError
								.fromError(err)
								.toProto()
							: undefined
					}
				})
					.catch(err => {
						logger.error(
							{ err },
							'failed to send tunnel disconnect event'
						)
					})
			},
		})

		client.tunnels[id] = tunnel

		return {}
	} catch(err) {
		apm?.captureError(err, { parent: sessionTx })
		tx?.setOutcome('failure')
		tx?.end()

		throw err
	}
}