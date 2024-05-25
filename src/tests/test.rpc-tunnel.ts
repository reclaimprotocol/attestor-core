import { TLSSocket } from 'tls'
import { WebSocketServer } from 'ws'
import { WebSocket } from 'ws'
import { CreateTunnelRequest } from '../proto/api'
import { logger } from '../utils'
import { makeRpcTcpTunnel, makeRpcTlsTunnel, WitnessClient } from '../v2'
import { makeWsServer } from '../v2/server'
import { createMockServer } from './mock-provider-server'
import { delay, getRandomPort, randomPrivateKey } from './utils'

describe('RPC Tunnel', () => {

	let wsServer: WebSocketServer
	let wsServerUrl: string

	let privateKeyHex: string
	let client: WitnessClient

	const mockHttpsServer = createMockServer(1234)

	beforeAll(async() => {
		const wsServerPort = getRandomPort()
		wsServer = await makeWsServer(wsServerPort)
		wsServerUrl = `ws://localhost:${wsServerPort}`
	})

	afterAll(() => {
		wsServer.close()
		mockHttpsServer.server.close()
	})

	beforeEach(async() => {
		privateKeyHex = randomPrivateKey()
		client = new WitnessClient({
			privateKeyHex,
			logger: logger.child({ client: 1 }),
			url: wsServerUrl
		})
		await client.waitForInit()
	})

	afterEach(async() => {
		await client.terminateConnection()
	})

	it.only('should connect to a server via RPC tunnel', async() => {
		const tunnel = await makeRpcTcpTunnel({
			request: {
				id: 1,
				host: 'localhost',
				port: 1234,
			},
			client,
			logger,
		})

		const ws = getClientWSOnServer()
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
			const ws = getClientWSOnServer()

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

	function getClientWSOnServer() {
		const serverSockets = [...wsServer.clients.values()] as WebSocket[]
		return serverSockets
			.find(s => (
				s.serverSocket?.metadata.userId === client.metadata.userId
			))
			?.serverSocket
	}
})