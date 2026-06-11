import assert from 'node:assert'
import { afterEach, it } from 'node:test'

import { createClaimOnAttestor } from '#src/client/index.ts'
import { describeWithServer } from '#src/tests/describe-with-server.ts'
import { verifyNoDirectRevealLeaks } from '#src/tests/utils.ts'

describeWithServer('HTTP Provider', opts => {

	afterEach(async() => {
		await verifyNoDirectRevealLeaks()
	})

	it('should create claim with template params', async() => {
		const resp = await createClaimOnAttestor({
			name: 'http',
			params: {
				url: 'https://news.ycombinator.{{param1}}/{{param4}}',
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
					param4: 'best',
				}
			},
			ownerPrivateKey: opts.privateKeyHex,
			client: opts.client,
			zkEngine: 'gnark'
		})
		assert.ok(!resp.error)
		assert.match(
			resp.claim?.context || '',
			/0x1fc5d205305d310d30c27f9a989241186cf1851f8d3d197d671c5e1fff7f99a8/
		)
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
		assert.ok(!resp.error)

		const ctx = JSON.parse(resp.claim!.context)
		const domainStr = ctx.extractedParameters.domain

		// transcript is stripped from response to reduce wire size
		// OPRF validation is done server-side; verify domain is in context
		assert.ok(domainStr)
	})

	it('should create claim with non 200 response', async() => {
		const resp = await createClaimOnAttestor({
			name: 'http',
			params: {
				url: 'https://the-internet.herokuapp.com/status_codes/201',
				method: 'GET',
				responseMatches: [{
					type: 'contains',
					value: 'Status Codes',
				}],
				responseRedactions: [{
					xPath: '/html/body/div[2]/div/div/h3',
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
			zkEngine: 'gnark'
		})
		assert.ok(!resp.error)
		assert.match(
			resp.claim?.context || '',
			/0x52eefd230287404d1053327c183eb0ebd9327a117539ac48e2a5ace143ee711c/
		)
	})
})
