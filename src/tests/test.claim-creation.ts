import { providers } from '../providers'
import { WitnessClient } from '../v2'
import { describeWithServer } from './describe-with-server'

describeWithServer('Claim Creation', opts => {

	// const { getClientOnServer } = opts

	beforeAll(() => {
		// we need to disable certificate verification
		// for testing purposes
		providers.http.additionalClientOptions = {
			...providers.http.additionalClientOptions,
			verifyServerCertificate: false
		}
	})

	let client: WitnessClient
	beforeEach(() => {
		client = opts.client
	})

	it('should successfully create a claim', async() => {
		const user = 'adhiraj'
		const result = await client.createClaim({
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
		})

		expect(result.error).toBeUndefined()
		expect(result.request?.transcript).toBeTruthy()
	})
})