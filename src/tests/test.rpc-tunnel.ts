import { TLSSocket } from 'tls'
import { CreateTunnelRequest } from '../proto/api'
import { logger } from '../utils'
import { makeRpcTcpTunnel, makeRpcTlsTunnel, WitnessClient } from '../v2'
import { describeWithServer } from './describe-with-server'
import { delay } from './utils'

describeWithServer('RPC Tunnel', opts => {

	const { mockHttpsServer, getClientOnServer } = opts

	let client: WitnessClient
	beforeEach(async() => {
		client = opts.client
	})

	afterEach(async() => {
		await client.terminateConnection()
	})

	it('should connect to a server via RPC tunnel', async() => {
		const tunnel = await makeRpcTcpTunnel({
			request: {
				id: 1,
				host: 'localhost',
				port: 1234,
			},
			client,
			logger,
		})

		const ws = getClientOnServer()
		const socketTunnel = ws?.tunnels[1]
		expect(socketTunnel).toBeTruthy()

		await tunnel.close()

		// check that the server actually closed the tunnel
		// upon our request
		await expect(
			socketTunnel?.write(Buffer.from('hello'))
		).rejects.toMatchObject({
			code: 'ERR_STREAM_WRITE_AFTER_END'
		})
	})

	describe('TLS', () => {
		it('should do a TLS handshake via RPC tunnel', async() => {
			const ws = getClientOnServer()

			let createReq: CreateTunnelRequest | undefined
			ws?.addEventListener('rpc-request', ({ data }) => {
				if(data.type !== 'createTunnel') {
					return
				}

				createReq = data.data as CreateTunnelRequest
			})

			const tunnel = await makeRpcTlsTunnel({
				request: {
					id: 1,
					host: 'localhost',
					port: 1234,
				},
				tlsOpts: {
					verifyServerCertificate: false,
				},
				client,
				logger,
			})

			expect(ws?.tunnels[1]).toBeTruthy()
			// ensure that the client hello message
			// was sent to the server via the createTunnelRequest
			// -- which saves us a round trip
			expect(createReq?.initialMessage).toBeTruthy()

			await tunnel.close()
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
					port: 1234,
				},
				tlsOpts: {
					verifyServerCertificate: false,
				},
				client,
				logger,
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
						port: 1234,
					},
					tlsOpts: {
						applicationLayerProtocols: [
							'invalid-protocol'
						]
					},
					client,
					logger,
				})
			).rejects.toMatchObject({
				message: /NO_APPLICATION_PROTOCOL/
			})
		})
	})
})