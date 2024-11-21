import { createClaimOnAttestor } from 'src/client'
import { providers } from 'src/providers'
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

	it('should create claim with OPRF template params', async() => {
		// OPRF is only available on gnark & chacha20 right now
		providers.http.additionalClientOptions = {
			...providers.http.additionalClientOptions,
			supportedProtocolVersions: ['TLS1_3'],
			cipherSuites: ['TLS_CHACHA20_POLY1305_SHA256']
		}

		const resp = await createClaimOnAttestor({
			name: 'http',
			params: {
				url: 'https://example.com/',
				method: 'GET',
				responseMatches: [
					{
						type: 'regex',
						value: '<title>(?<domain>.+)<\\/title>',
					}
				],
				responseRedactions: [
					{
						regex: '<title>(?<domain>.+)<\\/title>',
						hash: 'oprf'
					}
				],
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
})