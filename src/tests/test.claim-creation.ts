import { CipherSuite, TLSProtocolVersion, uint8ArrayToStr } from '@reclaimprotocol/tls'
import { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import { AttestorClient } from 'src/client'
import { createClaimOnAttestor, getAttestorClientFromPool } from 'src/client'
import { providers } from 'src/providers'
import { decryptTranscript } from 'src/server'
import { describeWithServer } from 'src/tests/describe-with-server'
import { SPY_PREPARER } from 'src/tests/mocks'
import { getFirstTOprfBlock, verifyNoDirectRevealLeaks } from 'src/tests/utils'
import {
	assertValidClaimSignatures,
	AttestorError,
	binaryHashToStr,
	extractApplicationDataFromTranscript,
	logger } from 'src/utils'

const TLS_VERSIONS: TLSProtocolVersion[] = [
	'TLS1_3',
	'TLS1_2',
]

const OPRF_CIPHER_SUITES: CipherSuite[] = [
	'TLS_CHACHA20_POLY1305_SHA256',
	'TLS_AES_256_GCM_SHA384',
	'TLS_AES_128_GCM_SHA256',
]

jest.setTimeout(90_000)

jest.mock('@reclaimprotocol/tls/lib/utils/parse-certificate', () => {
	const actual = jest.requireActual('@reclaimprotocol/tls/lib/utils/parse-certificate')
	return {
		__esModule: true,
		...actual,
		verifyCertificateChain: jest.fn().mockImplementation()
	}
})

describeWithServer('Claim Creation', opts => {

	const zkEngine: ZKEngine = 'gnark'

	let client: AttestorClient
	let claimUrl: string
	beforeEach(() => {
		client = opts.client
		claimUrl = `https://localhost:${opts.mockhttpsServerPort}/me`

		// we need to disable certificate verification
		// for testing purposes
		providers.http.additionalClientOptions = {
			verifyServerCertificate: false
		}
	})

	it.each(TLS_VERSIONS)('should successfully create a claim (%s)', async version => {
		providers.http.additionalClientOptions = {
			...providers.http.additionalClientOptions,
			supportedProtocolVersions: [version]
		}

		const user = 'adhiraj'
		const result = await createClaimOnAttestor({
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
			ownerPrivateKey: opts.privateKeyHex,
			client,
			zkEngine,
		})

		expect(result.error).toBeUndefined()
		expect(result.request?.transcript).toBeTruthy()

		// decrypt the transcript and check we didn't accidentally
		// leak our secrets in the application data
		const transcript = result.request!.transcript

		const applMsgs = extractApplicationDataFromTranscript(
			await decryptTranscript(
				transcript, logger, zkEngine,
				result.request?.fixedServerIV!, result.request?.fixedClientIV!
			)
		)

		const requestData = applMsgs
			.filter(m => m.sender === 'client')
			.map(m => uint8ArrayToStr(m.message))
			.join('')
		// ensure the secret authorisation header is not leaked
		expect(requestData).not.toContain(user)

		await expect(
			assertValidClaimSignatures(result, client.metadata)
		).resolves.toBeUndefined()

		expect(SPY_PREPARER).toHaveBeenCalledTimes(1)
		// check all direct message reveals and
		// ensure we've not accidentally re-used a key
		// for multiple application data messages that
		// were not meant to be revealed.
		await verifyNoDirectRevealLeaks()
	})

	it('should not create a claim with invalid response', async() => {

		await expect(async() => {
			await createClaimOnAttestor({
				name: 'http',
				params: {
					url: claimUrl,
					method: 'GET',
					responseRedactions: [],
					responseMatches: [
						{
							type: 'contains',
							value: 'something@mock.com'
						}
					]
				},
				secretParams: {
					authorisationHeader: 'Fail'
				},
				ownerPrivateKey: opts.privateKeyHex,
				client,
				zkEngine,
			})
		}).rejects.toThrow('Provider returned error 401')
	})

	describe('OPRF via %s', () => {

		const zkEngine = 'gnark'

		it.each(OPRF_CIPHER_SUITES)('should create a claim with an OPRF redaction (%s)', async cipherSuite => {
			// OPRF is only available on gnark & chacha20 right now
			providers.http.additionalClientOptions = {
				...providers.http.additionalClientOptions,
				cipherSuites: [cipherSuite]
			}

			const user = '(?<test>adhiraj)'
			const result = await createClaimOnAttestor({
				name: 'http',
				params: {
					url: claimUrl,
					method: 'GET',
					responseRedactions: [
						{
							regex: user,
							hash: 'oprf'
						}
					],
					responseMatches: [
						{
							type: 'contains',
							value: ''
						}
					]
				},
				secretParams: {
					authorisationHeader: `Bearer ${user}`
				},
				ownerPrivateKey: opts.privateKeyHex,
				client,
				zkEngine,
			})

			expect(result.error).toBeUndefined()
			// decrypt the transcript and check we didn't accidentally
			// leak our secrets in the application data
			const transcript = result.request!.transcript
			expect(transcript).toBeTruthy()

			const applMsgs = extractApplicationDataFromTranscript(
				await decryptTranscript(
					transcript, logger, zkEngine,
					result.request?.fixedServerIV!, result.request?.fixedClientIV!
				)
			)

			const serverPackets = applMsgs
				.filter(m => m.sender === 'server')
				.map(m => uint8ArrayToStr(m.message))
				.join('')

			const toprf = getFirstTOprfBlock(result.request!)!
			expect(toprf).toBeTruthy()

			// only the user's hash should be revealed
			expect(serverPackets).not.toContain(user)

			expect(serverPackets).toContain(
				binaryHashToStr(toprf.nullifier, toprf.dataLocation!.length)
			)
		})

		it('should produce the same hash for the same input', async() => {

			let hash: Uint8Array | undefined

			for(let i = 0;i < 2;i++) {
				const user = '(?<su>some-user)'
				const result = await createClaimOnAttestor({
					name: 'http',
					params: {
						url: claimUrl,
						method: 'GET',
						responseRedactions: [
							{
								regex: user,
								hash: 'oprf'
							}
						],
						responseMatches: [
							{
								type: 'contains',
								value: ''
							}
						]
					},
					secretParams: {
						authorisationHeader: `Bearer ${user}`
					},
					ownerPrivateKey: opts.privateKeyHex,
					client,
					zkEngine,
				})

				const toprf = getFirstTOprfBlock(result.request!)
				expect(toprf).toBeTruthy()
				hash ||= toprf!.nullifier

				expect(toprf!.nullifier).toEqual(hash)
			}
		})
	})

	describe('Pool', () => {

		it('should correctly throw error when tunnel creation fails', async() => {
			await expect(
				createClaimOnAttestor({
					name: 'http',
					params: {
						url: 'https://some.dns.not.exist',
						method: 'GET',
						responseRedactions: [],
						responseMatches: [
							{
								type: 'contains',
								value: 'test'
							}
						]
					},
					secretParams: {
						authorisationHeader: 'Bearer abcd'
					},
					ownerPrivateKey: opts.privateKeyHex,
					client: { url: opts.serverUrl },
					zkEngine
				})
			).rejects.toMatchObject({
				message: /ENOTFOUND/
			})
		})

		it('should reconnect client when found disconnected', async() => {
			await createClaim()
			// since we're using a pool, we'll find the client
			// disconnected and when we create the claim again
			// we expect a new connection to be established
			const client = getAttestorClientFromPool(opts.serverUrl)
			await client.terminateConnection()
			// ensure claim is still successful
			const result2 = await createClaim()
			expect(result2.claim).toBeTruthy()

			const client2 = getAttestorClientFromPool(opts.serverUrl)
			expect(client2).not.toBe(client)
		})

		it('should retry on network errors', async() => {
			const client = getAttestorClientFromPool(opts.serverUrl)
			client.sendMessage = async() => {
				// @ts-ignore
				client.sendMessage = () => {}

				const err = new AttestorError(
					'ERROR_NETWORK_ERROR',
					'F'
				)

				await client.terminateConnection(err)
				throw err
			}

			// first the client will mock disconnection when
			// sending a message -- that should trigger a retry
			// and result in a successful claim creation
			await expect(
				createClaim()
			).resolves.toBeTruthy()

			// ensure new client is created to replace
			// the disconnected one
			const client2 = getAttestorClientFromPool(opts.serverUrl)
			expect(client2).not.toBe(client)
		})
	})

	function createClaim() {
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
			ownerPrivateKey: opts.privateKeyHex,
			client: { url: opts.serverUrl }
		})
	}
})