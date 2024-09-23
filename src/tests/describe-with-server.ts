import { WitnessClient } from 'src/client/utils/client-socket'
import { WS_PATHNAME } from 'src/config'
import { createServer } from 'src/server'
import { createMockServer } from 'src/tests/mock-provider-server'
import { SPY_PREPARER } from 'src/tests/mocks'
import { getRandomPort, randomPrivateKey } from 'src/tests/utils'
import { IWitnessServerSocket, ZKEngine } from 'src/types'
import { logger } from 'src/utils'
import { WebSocket, type WebSocketServer } from 'ws'

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
	zkEngine: ZKEngine
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
		zkEngine: 'snarkJS'
	})

	function getClientOnServer() {
		const serverSockets = [...wsServer.clients.values()] as WebSocket[]
		return serverSockets.at(-1)?.serverSocket
	}
})