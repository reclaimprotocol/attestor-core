import { createClaimOnWitness } from '../create-claim'
import { ProviderParams } from '../types'
import { describeWithServer } from './describe-with-server'
import { verifyNoDirectRevealLeaks } from './utils'

jest.setTimeout(60_000)

describeWithServer('HTTP Provider', opts => {

	afterEach(async() => {
		await verifyNoDirectRevealLeaks()
	})

	it('should create claim with template params', async() => {
		const resp = await createClaimOnWitness({
			name: 'http',
			params: {
				url: 'https://example.{{param1}}/',
				method: 'GET',
				responseMatches: [{
					type: 'regex',
					value: '<title.*?(?<domain>{{param2}} Domain)<\\/title>',
				}],
				responseRedactions: [{
					xPath: './html/head/{{param3}}',
				}],
				paramValues: {
					param1: 'com',
					param2: 'Example',
					param3: 'title'
				}
			},
			secretParams: {
				cookieStr: '<cookie-str>'
			},
			ownerPrivateKey: opts.privateKeyHex,
			client: opts.client
		})
		expect(resp.error).toBeUndefined()
		expect(resp.claim?.context)
			.toContain('0x3bfcf3bf17b83b9c37756d9becf87f76cad712304a23d3335f78e1cc96e83d1f')
	})

	it('should throw on zero body length', async() => {
		const params: ProviderParams<'http'> = {
			url: 'https://example.{{param1}}/',
			method: 'GET',
			body: '{{h}}',
			geoLocation: 'US',
			responseMatches: [{
				type: 'regex',
				value: '<title.*?(?<domain>{{param2}} Domain)<\\/title>',
			},
			{
				type: 'contains',
				value: 'This domain is for use in {{what}} examples in documents',
			}
			],
			responseRedactions: [{
				xPath: './html/head/{{param3}}',
			}, {
				xPath: '/html/body/div/p[1]/text()'
			}],
			paramValues: {
				param1: 'com',
				param2: 'Example',
				param3: 'title',
				what: 'illustrative',
			},
			headers: {
				'user-agent': 'Mozilla/5.0',
			}
		}
		const receipt = await createClaimOnWitness({
			name: 'http',
			secretParams: {
				cookieStr: '<cookie-str>',
				paramValues: {
					h: '',
				},
				authorisationHeader: 'abc'
			},
			params: params,
			ownerPrivateKey: opts.privateKeyHex,
			client: opts.client,
		})
		expect(receipt?.error).toBeTruthy()
		expect(receipt?.error?.message).toContain('request body mismatch')
	})
})