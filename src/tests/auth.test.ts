import { ethers } from 'ethers'
import assert from 'node:assert'
import { after, before, describe, it } from 'node:test'
import type { WebSocketServer } from 'ws'

import { createClaimOnAttestor } from '#src/client/index.ts'
import { WS_PATHNAME } from '#src/config/index.ts'
import type { AuthenticationRequest } from '#src/proto/api.ts'
import { providers } from '#src/providers/index.ts'
import { createServer } from '#src/server/index.ts'
import { createMockServer } from '#src/tests/mock-provider-server.ts'
import { getRandomPort, randomPrivateKey } from '#src/tests/utils.ts'
import { type AttestorError, createAuthRequest } from '#src/utils/index.ts'

describe('Authentication Tests', () => {

	const authKp = ethers.Wallet.createRandom()
	let wsServer: WebSocketServer

	let wsServerUrl: string
	let claimUrl: string
	let privateKeyHex: string

	const wsServerPort = getRandomPort()
	const httpsServerPort = getRandomPort()

	const mockHttpsServer = createMockServer(httpsServerPort)

	before(async() => {
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

	after(() => {
		delete process.env.AUTHENTICATION_PUBLIC_KEY
		wsServer.close()
		mockHttpsServer.server.close()
	})

	it('should fail to create a claim w/o authentication', async() => {
		await assert.rejects(
			() => createClaim(undefined),
			(err: AttestorError) => {
				assert.equal(err.message, 'User must be authenticated')
				return true
			}
		)
	})

	it('should block claim creation if host not in whitelist', async() => {
		const auth = await createAuthRequest(
			{ id: '1234', hostWhitelist: ['api.abcd.com'] },
			authKp.privateKey
		)

		await assert.rejects(
			() => createClaim(auth),
			(err: AttestorError) => {
				assert.equal(err.message, 'Host "localhost" not allowed by auth request')
				return true
			}
		)
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