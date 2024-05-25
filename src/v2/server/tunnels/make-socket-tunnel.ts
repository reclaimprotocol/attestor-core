import { getServers, resolve, setServers } from 'dns'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ConnectResponse } from 'https-proxy-agent/dist/parse-proxy-response'
import { Socket } from 'net'
import { CONNECTION_TIMEOUT_MS, DNS_SERVERS } from '../../../config'
import { CreateTunnelRequest } from '../../../proto/api'
import type { Logger } from '../../../types'
import { logger as LOGGER, WitnessError } from '../../../utils'
import type { MakeTunnelFn, TCPSocketProperties } from '../../types'
import { isValidCountryCode } from '../utils/iso'

const HTTPS_PROXY_URL = process.env.HTTPS_PROXY_URL

type ExtraOpts = Omit<CreateTunnelRequest, 'id' | 'initialMessage'>
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
	host,
	port,
	geoLocation,
	logger = LOGGER,
	onClose,
	onMessage,
}) => {
	const socket = await getSocket({ host, port, geoLocation }, logger)
	const transcript: TCPSocketProperties['transcript'] = []

	let connectTimeout: NodeJS.Timeout | undefined
	try {
		await new Promise((resolve, reject) => {
			socket.once('connect', resolve)
			socket.once('error', reject)
			socket.once('end', () => reject(new Error('connection closed')))

			// add a timeout to ensure the connection doesn't hang
			// and cause our gateway to send out a 504
			connectTimeout = setTimeout(
				() => reject(new Error('server connection timed out')),
				CONNECTION_TIMEOUT_MS
			)
		})
	} finally {
		clearTimeout(connectTimeout)
	}

	logger.debug({ addr: `${host}:${port}` }, 'connected')

	socket.once('error', close)
	socket.once('end', () => close(undefined))
	socket.on('data', message => {
		onMessage?.(message)
		transcript.push({ sender: 'server', message })
	})

	return {
		transcript,
		createRequest: { host, port, geoLocation },
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
		close,
	}

	function close(error?: Error) {
		if(socket.readableEnded) {
			return
		}

		logger.debug({ err: error }, 'closing socket')

		socket.end()
		onClose?.(error)
		onClose = undefined
	}
}

setDnsServers()

async function getSocket(opts: ExtraOpts, logger: Logger) {
	try {
		return await _getSocket(opts, logger)
	} catch(err) {
		// see if the proxy is blocking the connection
		// due to their own arbitrary rules,
		// if so -- we resolve hostname first &
		// connect directly via address to
		// avoid proxy knowing which host we're connecting to
		if(
			!(err instanceof WitnessError)
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
				return await _getSocket(
					{ ...opts, host: addr },
					logger
				)
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
		geoLocation
	}: ExtraOpts,
	logger: Logger
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
		throw WitnessError.badRequest(
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
		throw new WitnessError(
			'WITNESS_ERROR_PROXY_ERROR',
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

async function resolveHostnames(hostname: string) {
	return new Promise<string[]>((_resolve, reject) => {
		resolve(hostname, (err, addresses) => {
			if(err) {
				reject(
					new Error(
						`Could not resolve hostname: ${hostname}, ${err.message}`
					)
				)
			} else {
				_resolve(addresses)
			}
		})
	})
}

function setDnsServers() {
	setServers([
		...DNS_SERVERS,
		...getServers(),
	])
}