import { TLSProtocolVersion, uint8ArrayToStr } from '@reclaimprotocol/tls'
import { WitnessClient } from '../client'
import { createClaimOnWitness } from '../create-claim'
import { WitnessErrorCode } from '../proto/api'
import { providers } from '../providers'
import { decryptTranscript } from '../server'
import { assertValidClaimSignatures, extractApplicationDataFromTranscript, logger } from '../utils'
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
})