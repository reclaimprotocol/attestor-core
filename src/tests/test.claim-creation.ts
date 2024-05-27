import { TLSProtocolVersion, uint8ArrayToStr } from '@reclaimprotocol/tls'
import { WitnessClient } from '../client'
import { createClaimOnWitness } from '../create-claim'
import { WitnessErrorCode } from '../proto/api'
import { providers } from '../providers'
import { decryptTranscript } from '../server'
import { extractApplicationDataFromTranscript, logger } from '../utils'
import { describeWithServer } from './describe-with-server'

const TLS_VERSIONS: TLSProtocolVersion[] = [
	'TLS1_3',
	'TLS1_2',
]

jest.setTimeout(15_000)

describeWithServer('Claim Creation', opts => {

	let client: WitnessClient
	beforeEach(() => {
		client = opts.client

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
				url: 'https://localhost:1234/me',
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

		const applMsgs = extractApplicationDataFromTranscript(
			await decryptTranscript(
				result.request!.transcript,
				logger
			)
		)

		const requestData = applMsgs
			.filter(m => m.sender === 'client')
			.map(m => uint8ArrayToStr(m.message))
			.join('')
		// ensure the secret authorisation header is not leaked
		expect(requestData).not.toContain(user)
	})

	it('should not create a claim with invalid response', async() => {
		const result = await createClaimOnWitness({
			name: 'http',
			params: {
				url: 'https://localhost:1234/me',
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