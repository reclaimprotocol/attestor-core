import { createChannel, createClient } from 'nice-grpc'
import { APITLSClientOptions, makeAPITLSClient } from '../api-client'
import { ReclaimWitnessDefinition } from '../proto/api'
import providers from '../providers'
import { makeGrpcServer } from '../server/make-grpc-server'
import { getTranscriptString } from '../utils'
import { createMockTLSServer } from './mock-tls-server'

jest.setTimeout(30000)

describe('API Tests', () => {

	const grpcServerPort = Math.floor(Math.random() * 10000 + 10000)
	const tlsServerPort = Math.floor(Math.random() * 10000 + 10000)

	const channel = createChannel(`localhost:${grpcServerPort}`)
	const server = makeGrpcServer(grpcServerPort)
	const tlsServer = createMockTLSServer(tlsServerPort)

	providers['mock-login'].hostPort = `localhost:${tlsServerPort}`

	beforeAll(async() => {
		await server
	})

	afterAll(async() => {
		await channel.close()
		await (await server).close()
		await tlsServer.server.close()
	})

	it('should handshake a session via API', async() => {
		const tlsClient = getTlsClient()

		await tlsClient.connect()
		await tlsClient.cancel()
	})

	it('should generate an out-of-band session', async() => {
		const tlsClient = getTlsClient()

		await tlsClient.generatePSK()
		await tlsClient.connect()
		await tlsClient.cancel()
	})

	it('should correctly generate the receipt', async() => {
		const apiSecret = 'my name jeff'
		const apiSecret1 = 'dadada cool secret cookie'
		const msg = `My cool API secret is "${apiSecret}". Please don't reveal it. And this too: "${apiSecret1}" please`
		const apiSecretIdx = msg.indexOf(apiSecret)
		const apiSecret1Idx = msg.indexOf(apiSecret1)
		const expectedMsgs = 3

		const tlsClient = getTlsClient({
			redactResponse(data) {
				const fromIndex = data.indexOf(apiSecret)
				const fromIndex1 = data.indexOf(apiSecret1)
				return [
					{
						fromIndex: fromIndex,
						toIndex: fromIndex + apiSecret.length
					},
					{
						fromIndex: fromIndex1,
						toIndex: fromIndex1 + apiSecret1.length
					}
				]
			},
		})

		await tlsClient.connect()

		let msgsRecv = 0

		const recvPromise = new Promise<void>(resolve => {
			tlsClient.handleDataFromServer(() => {
				msgsRecv += 1

				if(msgsRecv === expectedMsgs) {
					resolve()
				}
			})
		})

		await tlsClient.write(Buffer.from(msg), [
			{
				fromIndex: apiSecretIdx,
				toIndex: apiSecretIdx + apiSecret.length
			},
			{
				fromIndex: apiSecret1Idx,
				toIndex: apiSecret1Idx + apiSecret1.length
			}
		])

		await recvPromise

		const { receipt } = await tlsClient.finish()
		const str = getTranscriptString(receipt!.transcript)
		expect(str).not.toContain(apiSecret)
		expect(str).not.toContain(apiSecret1)
	})

	function getTlsClient(opts?: Partial<APITLSClientOptions>) {
		return makeAPITLSClient({
			host: 'localhost',
			port: tlsServerPort,
			client: getGrpcClient(),
			additionalConnectOpts: {
				verifyServerCertificate: false
			},
			...opts || {}
		})
	}

	function getGrpcClient() {
		return createClient(
			ReclaimWitnessDefinition,
			channel,
			{ }
		)
	}
})