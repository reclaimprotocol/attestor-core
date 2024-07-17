import { WebSocket, type WebSocketServer } from 'ws'
import { WitnessClient } from '../client'
import { WS_PATHNAME } from '../config'
import { createServer } from '../server'
import { IWitnessServerSocket } from '../types'
import { logger } from '../utils'
import { createMockServer } from './mock-provider-server'
import { SPY_PREPARER } from './mocks'
import { getRandomPort, randomPrivateKey } from './utils'

type ServerOpts = {
	/**
	 * Get the client's connection on the server.
	 */
	getClientOnServer(): IWitnessServerSocket | undefined
	client: WitnessClient
	privateKeyHex: string
	mockHttpsServer: ReturnType<typeof createMockServer>
	mockhttpsServerPort: number
	serverUrl: string
}

/**
 * Boots up a witness server, a mock https server,
 * and a client that is renewed for each test.
 */
export const describeWithServer = (
	name: string,
	fn: (opts: ServerOpts) => void
) => describe(name, () => {
	let wsServer: WebSocketServer

	let wsServerUrl: string

	let privateKeyHex: string
	let client: WitnessClient

	const wsServerPort = getRandomPort()
	const httpsServerPort = getRandomPort()

	const mockHttpsServer = createMockServer(httpsServerPort)

	beforeAll(async() => {
		wsServer = await createServer(wsServerPort)
		wsServerUrl = `ws://localhost:${wsServerPort}${WS_PATHNAME}`
	})

	afterAll(() => {
		wsServer.close()
		mockHttpsServer.server.close()
	})

	beforeEach(async() => {
		SPY_PREPARER.mockClear()

		privateKeyHex = randomPrivateKey()
		client = new WitnessClient({
			logger: logger.child({ client: 1 }),
			url: wsServerUrl,
			Websocket: WebSocket
		})
		await client.waitForInit()
	})

	afterEach(async() => {
		await client.terminateConnection()
	})

	fn({
		getClientOnServer,
		get client() {
			return client
		},
		get privateKeyHex() {
			return privateKeyHex
		},
		get serverUrl() {
			return wsServerUrl
		},
		mockHttpsServer,
		mockhttpsServerPort: httpsServerPort,
	})

	function getClientOnServer() {
		const serverSockets = [...wsServer.clients.values()] as WebSocket[]
		return serverSockets.at(-1)?.serverSocket
	}
})