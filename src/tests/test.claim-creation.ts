import { TLSProtocolVersion, uint8ArrayToStr } from '@reclaimprotocol/tls'
import { WitnessClient } from '../client'
import { createClaimOnWitness, getWitnessClientFromPool } from '../create-claim'
import { WitnessErrorCode } from '../proto/api'
import { providers } from '../providers'
import { decryptTranscript } from '../server'
import { assertValidClaimSignatures, extractApplicationDataFromTranscript, logger, WitnessError } from '../utils'
import { describeWithServer } from './describe-with-server'
import { SPY_PREPARER } from './mocks'
import { verifyNoDirectRevealLeaks } from './utils'

const TLS_VERSIONS: TLSProtocolVersion[] = [
	'TLS1_3',
	'TLS1_2',
]

jest.setTimeout(90_000)

describeWithServer('Claim Creation', opts => {

	let client: WitnessClient
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
		// we need to disable certificate verification
		// for testing purposes
		providers.http.additionalClientOptions = {
			...providers.http.additionalClientOptions,
			supportedProtocolVersions: [version]
		}

		const user = 'adhiraj'
		const result = await createClaimOnWitness({
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
			client
		})

		expect(result.error).toBeUndefined()
		expect(result.request?.transcript).toBeTruthy()

		// decrypt the transcript and check we didn't accidentally
		// leak our secrets in the application data
		const transcript = result.request!.transcript
		const applMsgs = extractApplicationDataFromTranscript(
			await decryptTranscript(transcript, logger)
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

		// check all direct message reveals and
		// ensure we've not accidentally re-used a key
		// for multiple application data messages that
		// were not meant to be revealed.
		expect(SPY_PREPARER).toHaveBeenCalledTimes(1)
		await verifyNoDirectRevealLeaks()
	})

	it('should not create a claim with invalid response', async() => {
		const result = await createClaimOnWitness({
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
		})

		expect(result.error).toBeTruthy()
		expect(result.error?.code).toEqual(
			WitnessErrorCode.WITNESS_ERROR_INVALID_CLAIM
		)
		expect(result.error?.message).toMatch(/Response did not start with/)
		expect(result.request?.transcript).toBeTruthy()
	})

	describe('Pool', () => {

		it('should correctly throw error when tunnel creation fails', async() => {
			await expect(
				createClaimOnWitness({
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
					client: { url: opts.serverUrl }
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
			const client = getWitnessClientFromPool(opts.serverUrl)
			await client.terminateConnection()
			// ensure claim is still successful
			const result2 = await createClaim()
			expect(result2.claim).toBeTruthy()

			const client2 = getWitnessClientFromPool(opts.serverUrl)
			expect(client2).not.toBe(client)
		})

		it('should retry on network errors', async() => {
			const client = getWitnessClientFromPool(opts.serverUrl)
			client.sendMessage = async() => {
				// @ts-ignore
				client.sendMessage = () => {}

				const err = new WitnessError(
					'WITNESS_ERROR_NETWORK_ERROR',
					'F'
				)

				client.terminateConnection(err)
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
			const client2 = getWitnessClientFromPool(opts.serverUrl)
			expect(client2).not.toBe(client)
		})

		function createClaim() {
			const user = 'testing-123'
			return createClaimOnWitness({
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
})