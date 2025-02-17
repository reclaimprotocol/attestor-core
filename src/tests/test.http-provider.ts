import { createClaimOnAttestor } from 'src/client'
import { describeWithServer } from 'src/tests/describe-with-server'
import { getFirstTOprfBlock, verifyNoDirectRevealLeaks } from 'src/tests/utils'
import { binaryHashToStr } from 'src/utils'

jest.setTimeout(300_000)

describeWithServer('HTTP Provider', opts => {

	afterEach(async() => {
		await verifyNoDirectRevealLeaks()
	})

	it('should create claim with template params', async() => {
		const resp = await createClaimOnAttestor({
			name: 'http',
			params: {
				url: 'https://news.ycombinator.{{param1}}/{{param6}}?token={{param4}}&token1={{param5}}',
				method: 'GET',
				responseMatches: [{
					type: 'regex',
					value: '<title.*?(?<domain>{{param2}})<\\/title>',
				}],
				responseRedactions: [{
					xPath: './html/head/{{param3}}',
				}],
				paramValues: {
					param1: 'com',
					param2: 'Top Links | Hacker News',
					param3: 'title',

				}
			},
			secretParams: {
				cookieStr: '<cookie-str>',
				paramValues: {
					param4: 'quhrfqiuherfqlireufh',
					param5: 'sssbbbbr123',
					param6: 'best',
				}
			},
			ownerPrivateKey: opts.privateKeyHex,
			client: opts.client,
			zkEngine:'gnark'
		})
		expect(resp.error).toBeUndefined()
		expect(resp.claim?.context)
			.toContain('0x5e3e976476ded7b58120d606b33b75be52adb8345a7979c181764f00763e7b2a')
	})

	it('should create claim with OPRF template params', async() => {
		const resp = await createClaimOnAttestor({
			name: 'http',
			params: {
				url: 'https://example.com/',
				method: 'GET',
				responseMatches: [
					{
						type: 'contains',
						value: '<title>{{domain}}</title>',
					}
				],
				responseRedactions: [
					{
						xPath: '/html/head/title',
						regex: '<title>(?<domain>.*?)<\\/title>',
						hash: 'oprf'
					}
				],
				paramValues:{ domain:'Example Domain' }
			},
			secretParams: {
				cookieStr: '<cookie-str>'
			},
			ownerPrivateKey: opts.privateKeyHex,
			client: opts.client,
			zkEngine: 'gnark',
		})
		expect(resp.error).toBeUndefined()

		const ctx = JSON.parse(resp.claim!.context)
		const domainStr = ctx.extractedParameters.domain


		const toprf = getFirstTOprfBlock(resp.request!)!
		expect(toprf).toBeTruthy()
		const toprfStr = binaryHashToStr(
			toprf.nullifier,
			toprf.dataLocation!.length
		)
		expect(domainStr).toEqual(toprfStr.slice(0, domainStr.length))
	})

	it('should create claim with non 200 response', async() => {
		const resp = await createClaimOnAttestor({
			name: 'http',
			params: {
				url: 'https://httpstat.us/201',
				method: 'GET',
				responseMatches: [{
					type: 'contains',
					value: 'Created',
				}],
				responseRedactions: [{
					jsonPath: '$.description',
				}],
				headers: {
					accept: 'application/json, text/plain, */*'
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
			.toContain('0xd18ff964dfce6a3074791ec6a6c358f7f122c838b01c3e0565b33eac29515bc6')
	})
})