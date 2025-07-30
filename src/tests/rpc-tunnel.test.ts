import assert from 'assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { TLSSocket } from 'tls'

import { AttestorClient } from '#src/client/index.ts'
import { makeRpcTcpTunnel } from '#src/client/tunnels/make-rpc-tcp-tunnel.ts'
import { makeRpcTlsTunnel } from '#src/client/tunnels/make-rpc-tls-tunnel.ts'
import { describeWithServer } from '#src/tests/describe-with-server.ts'
import { delay } from '#src/tests/utils.ts'
import type { AttestorError } from '#src/utils/index.ts'
import { logger } from '#src/utils/index.ts'

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
		assert.ok(socketTunnel)

		await tunnel.close()

		// check that the server actually closed the tunnel
		// upon our request
		await assert.rejects(
			async() => socketTunnel?.write(Buffer.from('hello')),
			(err: AttestorError) => {
				assert.strictEqual(err.code, 'ERR_STREAM_DESTROYED')
				return true
			}
		)
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
					assert.ok(initMessages[1].tunnelMessage)
					return client
				},
			})

			assert.ok(ws?.tunnels[1])

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

			assert.ok(socket)
			socket?.end()

			const err = await new Promise<Error | undefined>((resolve) => {
				closeResolve = resolve
			})
			// since it was a graceful close, there should be no error
			assert.ok(!err)
		})

		it('should handle TLS handshake errors', async() => {
			await assert.rejects(
				async() => makeRpcTlsTunnel({
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
				}),
				(err: AttestorError) => {
					assert.match(err.message, /NO_APPLICATION_PROTOCOL/)
					return true
				}
			)
		})

		it('should handle tunnel creation errors', async() => {
			await assert.rejects(
				async() => makeRpcTlsTunnel({
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
				}),
				(err: AttestorError) => {
					assert.match(err.message, /Geolocation "XZ" is invalid/)
					return true
				}
			)
		})
	})
})