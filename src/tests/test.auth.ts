import { ethers } from 'ethers'
import type { WebSocketServer } from 'ws'

import { createClaimOnAttestor } from '#src/client/index.ts'
import { WS_PATHNAME } from '#src/config/index.ts'
import type { AuthenticationRequest } from '#src/proto/api.ts'
import { providers } from '#src/providers/index.ts'
import { createServer } from '#src/server/index.ts'
import { createMockServer } from '#src/tests/mock-provider-server.ts'
import { getRandomPort, randomPrivateKey } from '#src/tests/utils.ts'
import { createAuthRequest } from '#src/utils/index.ts'

describe('Authentication Tests', () => {

	const authKp = ethers.Wallet.createRandom()
	let wsServer: WebSocketServer

	let wsServerUrl: string
	let claimUrl: string
	let privateKeyHex: string

	const wsServerPort = getRandomPort()
	const httpsServerPort = getRandomPort()

	const mockHttpsServer = createMockServer(httpsServerPort)

	beforeAll(async() => {
		wsServer = await createServer(wsServerPort)
		wsServerUrl = `ws://localhost:${wsServerPort}${WS_PATHNAME}`
		process.env.AUTHENTICATION_PUBLIC_KEY = authKp.publicKey
		claimUrl = `https://localhost:${httpsServerPort}/me`
		privateKeyHex = randomPrivateKey()

		// we need to disable certificate verification
		// for testing purposes
		providers.http.additionalClientOptions = {
			verifyServerCertificate: false
		}
	})

	afterAll(() => {
		delete process.env.AUTHENTICATION_PUBLIC_KEY
		wsServer.close()
		mockHttpsServer.server.close()
	})

	it('should fail to create a claim w/o authentication', async() => {
		await expect(
			createClaim(undefined)
		).rejects.toMatchObject({
			message: 'User must be authenticated'
		})
	})

	it('should block claim creation if host not in whitelist', async() => {
		const auth = await createAuthRequest(
			{ id: '1234', hostWhitelist: ['api.abcd.com'] },
			authKp.privateKey
		)

		await expect(
			createClaim(auth)
		).rejects.toMatchObject({
			message: 'Host \"localhost\" not allowed by auth request'
		})
	})

	it('should create claim after authentication', async() => {
		const auth = await createAuthRequest(
			{ id: '1234', hostWhitelist: ['localhost'] },
			authKp.privateKey
		)

		await createClaim(auth)
	})

	function createClaim(authRequest: AuthenticationRequest | undefined) {
		const user = 'testing-123'
		return createClaimOnAttestor({
			name: 'http',
			params: {
				url: claimUrl,
				method: 'GET',
				responseRedactions: [],
				responseMatches: [
					{
						type: 'contains',
						value: `${user}@mock.com`
					}
				]
			},
			secretParams: {
				authorisationHeader: `Bearer ${user}`
			},
			ownerPrivateKey: privateKeyHex,
			client: { url: wsServerUrl, authRequest }
		})
	}
})