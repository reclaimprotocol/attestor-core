import { WebSocketServer } from 'ws'
import { WitnessError } from '../utils'
import { logger } from '../utils/logger'
import { makeReclaimClient } from '../v2'
import { makeWsServer } from '../v2/server'
import { getRandomPort, randomPrivateKey } from './utils'

describe('RPC Communication', () => {

	let wsServer: WebSocketServer
	let wsServerUrl: string

	let privateKeyHex: string
	let client: WebSocket

	beforeAll(async() => {
		const wsServerPort = getRandomPort()
		wsServer = await makeWsServer(wsServerPort)
		wsServerUrl = `ws://localhost:${wsServerPort}`
	})

	afterAll(() => {
		wsServer.close()
	})

	beforeEach(() => {
		privateKeyHex = randomPrivateKey()
		client = makeReclaimClient({
			privateKeyHex,
			logger: logger.child({ client: 1 }),
			url: wsServerUrl
		})
	})

	afterEach(() => {
		client.close()
	})

	it('should successfully initialise a session', async() => {
		await expect(client.waitForInit()).resolves.toBeUndefined()
		expect(client.initialised).toBe(true)
		// ensure the server has a client
		expect(wsServer.clients.keys()).toBeTruthy()
	})

	describe('With Initialised Connection', () => {

		beforeEach(async() => {
			await client.waitForInit()
		})

		it('should gracefully handle terminated connection', async() => {
			client.terminateConnection()
			client = makeReclaimClient({
				privateKeyHex,
				logger,
				url: 'ws://localhost:1234'
			})
			await expect(client.waitForInit()).rejects.toHaveProperty('code')
		})

		it('should gracefully handle connection termination', async() => {
			const err = new WitnessError(
				'WITNESS_ERROR_INTERNAL',
				'Test error',
				{ abcd: 1 }
			)
			const waitForEnd = new Promise<WitnessError>(resolve => {
				client.addEventListener('connection-terminated', d => {
					resolve(d.data)
				})
			})

			const ws = getClientWSOnServer()!
			await ws.terminateConnection(err)
			const recvErr = await waitForEnd
			expect(recvErr).toEqual(err)
			expect(client.readyState).not.toBe(WebSocket.OPEN)
		})

		it('should terminate connection to server', async() => {
			const ws = getClientWSOnServer()!
			const waitForEnd = new Promise<WitnessError>(resolve => {
				ws.addEventListener('connection-terminated', d => {
					resolve(d.data)
				})
			})

			await client.terminateConnection()
			await waitForEnd
		})

		it('should handle RPC error response', async() => {
			const err = new WitnessError(
				'WITNESS_ERROR_INTERNAL',
				'Test error',
				{ abcd: 1 }
			)

			const ws = getClientWSOnServer()!
			// @ts-ignore
			ws.removeAllListeners('rpc-request')

			ws.addEventListener('rpc-request', data => {
				data.data.respond(err)
			})

			await expect(
				client.rpc(
					'createTunnel',
					{
						host: 'localhost',
						port: 1234,
					}
				)
			).rejects.toMatchObject(err)
		})
	})

	function getClientWSOnServer() {
		const serverSockets = [
			...wsServer.clients.values()
		] as unknown as WebSocket[]
		return serverSockets.find(s => (
			s.metadata.userId === client.metadata.userId
		))
	}
})