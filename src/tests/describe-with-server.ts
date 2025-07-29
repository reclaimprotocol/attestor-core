import { AttestorClient } from 'src/client/utils/client-socket.ts'
import { WS_PATHNAME } from 'src/config/index.ts'
import { createServer } from 'src/server/index.ts'
import { createMockServer } from 'src/tests/mock-provider-server.ts'
import { SPY_PREPARER } from 'src/tests/mocks.ts'
import { getRandomPort, randomPrivateKey } from 'src/tests/utils.ts'
import { IAttestorServerSocket } from 'src/types/index.ts'
import { logger } from 'src/utils/index.ts'
import { WebSocket, type WebSocketServer } from 'ws'

type ServerOpts = {
	/**
	 * Get the client's connection on the server.
	 */
	getClientOnServer(): IAttestorServerSocket | undefined
	client: AttestorClient
	privateKeyHex: string
	mockHttpsServer: ReturnType<typeof createMockServer>
	mockhttpsServerPort: number
	serverUrl: string
}


/**
 * Boots up a attestor server, a mock https server,
 * and a client that is renewed for each test.
 */
export const describeWithServer = (
	name: string,
	fn: (opts: ServerOpts) => void
) => describe(name, () => {
	let wsServer: WebSocketServer

	let wsServerUrl: string

	let privateKeyHex: string
	let client: AttestorClient

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
		client = new AttestorClient({
			logger: logger.child({ client: 1 }),
			url: wsServerUrl,
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