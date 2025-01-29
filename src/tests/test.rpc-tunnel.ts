import { AttestorClient } from 'src/client'
import { makeRpcTcpTunnel } from 'src/client/tunnels/make-rpc-tcp-tunnel'
import { makeRpcTlsTunnel } from 'src/client/tunnels/make-rpc-tls-tunnel'
import { describeWithServer } from 'src/tests/describe-with-server'
import { delay } from 'src/tests/utils'
import { logger } from 'src/utils'
import { TLSSocket } from 'tls'

describeWithServer('RPC Tunnel', opts => {

	const { mockHttpsServer, getClientOnServer } = opts

	let client: AttestorClient
	beforeEach(async() => {
		client = opts.client
	})

	afterEach(async() => {
		await client.terminateConnection()
	})

	it('should connect to a server via RPC tunnel', async() => {
		// setup tunnel for listening & then
		// connect to it via RPC
		const tunnel = await makeRpcTcpTunnel({ tunnelId: 1, client })
		await client.rpc(
			'createTunnel',
			{
				id: 1,
				host: 'localhost',
				port: opts.mockhttpsServerPort,
				geoLocation: ''
			}
		)

		const ws = getClientOnServer()
		const socketTunnel = ws?.tunnels[1]
		expect(socketTunnel).toBeTruthy()

		await tunnel.close()

		// check that the server actually closed the tunnel
		// upon our request
		await expect(
			socketTunnel?.write(Buffer.from('hello'))
		).rejects.toMatchObject({
			code: 'ERR_STREAM_DESTROYED'
		})
	})

	describe('TLS', () => {
		it('should do a TLS handshake via RPC tunnel', async() => {
			const ws = getClientOnServer()
			const tunnel = await makeRpcTlsTunnel({
				request: {
					id: 1,
					host: 'localhost',
					port: opts.mockhttpsServerPort,
				},
				tlsOpts: {
					verifyServerCertificate: false,
				},
				logger: client.logger,
				connect(initMessages) {
					client.sendMessage(...initMessages)
						.catch(() => {})
					// ensure that the client hello message
					// was sent to the server along the
					// "createTunnel" request -- that saves
					// us a round-trip
					expect(initMessages[1].tunnelMessage)
						.toBeTruthy()
					return client
				},
			})

			expect(ws?.tunnels[1]).toBeTruthy()

			await tunnel.close()
		})

		it('should setup a 0-RTT TLS connection', async() => {
			let client2: AttestorClient | undefined
			const tunnel = await makeRpcTlsTunnel({
				request: {
					id: 1,
					host: 'localhost',
					port: opts.mockhttpsServerPort,
				},
				tlsOpts: {
					verifyServerCertificate: false,
				},
				logger: client.logger,
				connect(initMessages) {
					client2 = new AttestorClient({
						url: opts.serverUrl,
						logger: logger.child({ client: 2 }),
						initMessages
					})
					return client2
				},
			})

			await tunnel.close()
			await client2?.terminateConnection()
		})

		it('should gracefully handle a TLS disconnection alert', async() => {
			let socket: TLSSocket | undefined
			mockHttpsServer.server.once('secureConnection', s => {
				socket = s
			})

			let closeResolve: ((value?: Error) => void) | undefined
			await makeRpcTlsTunnel({
				request: {
					id: 1,
					host: 'localhost',
					port: opts.mockhttpsServerPort,
				},
				tlsOpts: {
					verifyServerCertificate: false,
				},
				logger: client.logger,
				connect(initMessages) {
					client.sendMessage(...initMessages)
						.catch(() => {})
					return client
				},
				onClose(err) {
					closeResolve?.(err)
				},
			})

			await delay(100)

			expect(socket).toBeTruthy()
			socket?.end()

			const err = await new Promise<Error | undefined>((resolve) => {
				closeResolve = resolve
			})
			// since it was a graceful close, there should be no error
			expect(err).toBeUndefined()
		})

		it('should handle TLS handshake errors', async() => {
			await expect(
				makeRpcTlsTunnel({
					request: {
						id: 1,
						host: 'localhost',
						port: opts.mockhttpsServerPort,
					},
					tlsOpts: {
						applicationLayerProtocols: [
							'invalid-protocol'
						]
					},
					logger: client.logger,
					connect(initMessages) {
						client.sendMessage(...initMessages)
							.catch(() => {})
						return client
					},
				})
			).rejects.toMatchObject({
				message: /NO_APPLICATION_PROTOCOL/
			})
		})

		it('should handle tunnel creation errors', async() => {
			await expect(
				makeRpcTlsTunnel({
					request: {
						id: 1,
						host: 'localhost',
						port: opts.mockhttpsServerPort,
						// invalid geo location
						geoLocation: 'XZ'
					},
					tlsOpts: {
						applicationLayerProtocols: [
							'invalid-protocol'
						]
					},
					logger: client.logger,
					connect(initMessages) {
						client.sendMessage(...initMessages)
							.catch(() => {})
						return client
					},
				})
			).rejects.toMatchObject({
				message: /NO_APPLICATION_PROTOCOL/
			})
		})
	})
})