import { TLSProtocolVersion } from '@reclaimprotocol/tls'
import { createClaimOnAttestor } from 'src/client'
import { createClaimOnMechain } from 'src/mechain/client/create-claim-on-mechain'
import { providers } from 'src/providers'
import { describeWithServer } from 'src/tests/describe-with-server'

const TLS_VERSIONS: TLSProtocolVersion[] = [
	'TLS1_3',
	'TLS1_2',
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


	beforeEach(() => {
		// we need to disable certificate verification
		// for testing purposes
		providers.http.additionalClientOptions = {
			verifyServerCertificate: false
		}
	})

	it.each(TLS_VERSIONS)('should successfully create a task on Mechain (%s)', async version => {
		providers.http.additionalClientOptions = {
			...providers.http.additionalClientOptions,
			supportedProtocolVersions: [version]
		}

		// const userWallet = Wallet.createRandom()
		const createClaimFn = jest.fn<
		ReturnType<typeof createClaimOnAttestor>,
		Parameters<typeof createClaimOnAttestor>
	>(() => {
		throw new Error('Not implemented')
	})

		const client = {
			url: 'ws://localhost:8001/ws'
		}

		const result = await createClaimOnMechain ({

			ownerPrivateKey: opts.privateKeyHex,
			name: 'http',
			params: {
				url: 'https://example.com',
				method: 'GET',
				responseRedactions: [],
				responseMatches: [
					{
						type: 'contains',
						value: 'test'
					}
				]
			},
			client,
			secretParams: {},
			createClaimOnAttestor: createClaimFn
		}
		)

		expect(result.responses).toBeDefined

	})


})