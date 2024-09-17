import { createClaimOnAttestor } from 'src/client'
import { describeWithServer } from 'src/tests/describe-with-server'
import { verifyNoDirectRevealLeaks } from 'src/tests/utils'

jest.setTimeout(300_000)

describeWithServer('HTTP Provider', opts => {

	afterEach(async() => {
		await verifyNoDirectRevealLeaks()
	})

	it('should create claim with template params', async() => {
		const resp = await createClaimOnAttestor({
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
			client: opts.client,
			zkEngine:'gnark'
		})
		expect(resp.error).toBeUndefined()
		expect(resp.claim?.context)
			.toContain('0x3bfcf3bf17b83b9c37756d9becf87f76cad712304a23d3335f78e1cc96e83d1f')
	})
})