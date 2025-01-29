import { makeTcpTunnel } from 'src/server/tunnels/make-tcp-tunnel'
import { getApm } from 'src/server/utils/apm'
import { resolveHostnames } from 'src/server/utils/dns'
import { RPCHandler, Tunnel } from 'src/types'
import { AttestorError } from 'src/utils'

export const createTunnel: RPCHandler<'createTunnel'> = async(
	{ id, ...opts },
	{ tx, logger, client }
) => {
	if(client.tunnels[id]) {
		throw AttestorError.badRequest(`Tunnel "${id}" already exists`)
	}

	const allowedHosts = client.metadata?.auth?.data?.hostWhitelist
	if(allowedHosts?.length && !allowedHosts.includes(opts.host)) {
		throw AttestorError.badRequest(
			`Host "${opts.host}" not allowed by auth request`
		)
	}

	let cancelBgp: (() => void) | undefined

	const apm = getApm()
	const sessionTx = apm?.startTransaction('tunnelConnection', { childOf: tx })
	sessionTx?.setLabel('tunnelId', id.toString())
	sessionTx?.setLabel('hostPort', `${opts.host}:${opts.port}`)
	sessionTx?.setLabel('geoLocation', opts.geoLocation)

	try {
		const tunnel = await makeTcpTunnel({
			...opts,
			logger,
			onMessage(message) {
				if(!client.isOpen) {
					logger.warn('client is closed, dropping message')
					return
				}

				void client.sendMessage({
					tunnelMessage: {
						tunnelId: id,
						message
					}
				})
			},
			onClose(err) {
				cancelBgp?.()

				if(err) {
					apm?.captureError(err, { parent: sessionTx })
					sessionTx?.setOutcome('failure')
				} else {
					sessionTx?.setOutcome('success')
				}

				sessionTx?.end()

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

		try {
			await checkForBgp(tunnel)
		} catch(err) {
			logger.warn(
				{ err, host: opts.host },
				'failed to start BGP overlap check'
			)
		}

		client.tunnels[id] = tunnel

		return {}
	} catch(err) {
		apm?.captureError(err, { parent: sessionTx })
		sessionTx?.setOutcome('failure')
		sessionTx?.end()
		cancelBgp?.()

		throw err
	}

	async function checkForBgp(tunnel: Tunnel<unknown>) {
		if(!client.bgpListener) {
			return
		}

		// listen to all IPs for the host -- in case any of them
		// has a BGP announcement overlap, we'll close the tunnel
		// so the user can retry
		const ips = await resolveHostnames(opts.host)
		cancelBgp = client.bgpListener.onOverlap(ips, (info) => {
			logger.warn(
				{ info, host: opts.host },
				'BGP announcement overlap detected'
			)
			// track how many times we've seen a BGP overlap
			sessionTx?.addLabels({ bgpOverlap: true, ...info })

			void tunnel?.close(
				new AttestorError(
					'ERROR_BGP_ANNOUNCEMENT_OVERLAP',
					`BGP announcement overlap detected for ${opts.host}`,
				)
			)
		})

		logger.debug({ ips }, 'checking for BGP overlap')
	}
}