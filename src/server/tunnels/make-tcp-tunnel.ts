import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ConnectResponse } from 'https-proxy-agent/dist/parse-proxy-response'
import { Socket } from 'net'
import { CONNECTION_TIMEOUT_MS } from 'src/config'
import { CreateTunnelRequest } from 'src/proto/api'
import { resolveHostnames } from 'src/server/utils/dns'
import { isValidCountryCode } from 'src/server/utils/iso'
import type { Logger } from 'src/types'
import type { MakeTunnelFn, TCPSocketProperties } from 'src/types'
import { AttestorError } from 'src/utils'
import { getEnvVariable } from 'src/utils/env'

const HTTPS_PROXY_URL = getEnvVariable('HTTPS_PROXY_URL')

type ExtraOpts = Omit<CreateTunnelRequest, 'id' | 'initialMessage'> & {
	logger: Logger
}
/**
 * Builds a TCP tunnel to the given host and port.
 * If a geolocation is provided -- an HTTPS proxy is used
 * to connect to the host.
 *
 * HTTPS proxy essentially creates an opaque tunnel to the
 * host using the CONNECT method. Any data can be sent through
 * this tunnel to the end host.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/CONNECT
 *
 * The tunnel also retains a transcript of all messages sent and received.
 */
export const makeTcpTunnel: MakeTunnelFn<ExtraOpts, TCPSocketProperties> = async({
	onClose,
	onMessage,
	logger,
	...opts
}) => {
	const transcript: TCPSocketProperties['transcript'] = []
	const socket = await connectTcp({ ...opts, logger })

	let closed = false


	socket.on('data', message => {
		if(closed) {
			logger.warn('socket is closed, dropping message')
			return
		}

		onMessage?.(message)
		transcript.push({ sender: 'server', message })
	})

	socket.once('error', onSocketClose)
	socket.once('close', () => onSocketClose(undefined))

	return {
		socket,
		transcript,
		createRequest: opts,
		async write(data) {
			transcript.push({ sender: 'client', message: data })
			await new Promise<void>((resolve, reject) => {
				socket.write(data, err => {
					if(err) {
						reject(err)
					} else {
						resolve()
					}
				})
			})
		},
		close(err?: Error) {
			if(closed) {
				return
			}

			socket.destroy(err)
		}
	}

	function onSocketClose(err?: Error) {
		if(closed) {
			return
		}

		logger.debug({ err }, 'closing socket')

		closed = true

		onClose?.(err)
		onClose = undefined
	}
}

async function connectTcp({ host, port, geoLocation, logger }: ExtraOpts) {
	let connectTimeout: NodeJS.Timeout | undefined
	let socket: Socket | undefined
	try {
		await new Promise(async(resolve, reject) => {
			try {
				// add a timeout to ensure the connection doesn't hang
				// and cause our gateway to send out a 504
				connectTimeout = setTimeout(
					() => reject(
						new AttestorError(
							'ERROR_NETWORK_ERROR',
							'Server connection timed out'
						)
					),
					CONNECTION_TIMEOUT_MS
				)
				socket = await getSocket({
					host,
					port,
					geoLocation,
					logger
				})
				socket.once('connect', resolve)
				socket.once('error', reject)
				socket.once('end', () => (
					reject(
						new AttestorError(
							'ERROR_NETWORK_ERROR',
							'connection closed'
						)
					)
				))
			} catch(err) {
				reject(err)
			}
		})

		logger.debug({ addr: `${host}:${port}` }, 'connected')

		return socket!
	} catch(err) {
		socket?.end()
		throw err
	} finally {
		clearTimeout(connectTimeout)
	}
}

async function getSocket(opts: ExtraOpts) {
	const { logger } = opts
	try {
		return await _getSocket(opts)
	} catch(err) {
		// see if the proxy is blocking the connection
		// due to their own arbitrary rules,
		// if so -- we resolve hostname first &
		// connect directly via address to
		// avoid proxy knowing which host we're connecting to
		if(
			!(err instanceof AttestorError)
			|| err.data?.code !== 403
		) {
			throw err
		}

		const addrs = await resolveHostnames(opts.host)
		logger.info(
			{ addrs, host: opts.host },
			'failed to connect due to restricted IP, trying via raw addr'
		)

		for(const addr of addrs) {
			try {
				return await _getSocket({ ...opts, host: addr })
			} catch(err) {
				logger.error(
					{ addr, err },
					'failed to connect to host'
				)
			}
		}

		throw err
	}
}

async function _getSocket(
	{
		host,
		port,
		geoLocation,
		logger
	}: ExtraOpts,
) {
	const socket = new Socket()
	if(geoLocation && !HTTPS_PROXY_URL) {
		logger.warn(
			{ geoLocation },
			'geoLocation provided but no proxy URL found'
		)
		geoLocation = ''
	}

	if(!geoLocation) {
		socket.connect({ host, port, })
		return socket
	}

	if(!isValidCountryCode(geoLocation)) {
		throw AttestorError.badRequest(
			`Geolocation "${geoLocation}" is invalid. Must be 2 letter ISO country code`,
			{ geoLocation }
		)
	}

	const agentUrl = HTTPS_PROXY_URL!.replace(
		'{{geoLocation}}',
		geoLocation?.toLowerCase() || ''
	)

	const agent = new HttpsProxyAgent(agentUrl)
	const waitForProxyRes = new Promise<ConnectResponse>(resolve => {
		// @ts-ignore
		socket.once('proxyConnect', resolve)
	})

	const proxySocket = await agent.connect(
		// ignore, because https-proxy-agent
		// expects an http request object
		// @ts-ignore
		socket,
		{ host, port, timeout: CONNECTION_TIMEOUT_MS }
	)

	const res = await waitForProxyRes
	if(res.statusCode !== 200) {
		logger.error(
			{ geoLocation, res },
			'Proxy geo location failed'
		)
		throw new AttestorError(
			'ERROR_PROXY_ERROR',
			`Proxy via geo location "${geoLocation}" failed with status code: ${res.statusCode}, message: ${res.statusText}`,
			{
				code: res.statusCode,
				message: res.statusText,
			}
		)
	}

	process.nextTick(() => {
		// ensure connect event is emitted
		// so it can be captured by the caller
		proxySocket.emit('connect')
	})

	return proxySocket
}