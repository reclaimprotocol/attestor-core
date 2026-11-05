import assert from 'node:assert'
import { describe, it } from 'node:test'

import { makeRegex } from '#src/providers/http/utils.ts'
import {
	getPublicAddresses,
	matchesHostPattern,
	safeFetch
} from '#src/server/utils/generics.ts'
import { AttestorError } from '#src/utils/error.ts'

describe('Misc Tests', () => {

	it('should use re2', () => {
		const re2 = makeRegex('abcd')
		assert(re2.exec('abcd'))
		assert.equal(re2.constructor.name, 'RE2')
	})

	it('should allow public IP access', async () => {
		const allowed = await getPublicAddresses('www.google.com')
		assert.ok(allowed.length)
	})

	it('should prevent private IP access', async () => {
		const REJECTIONS = [
			'169.254.169.254',
			'localhost',
			'fd00:ec2::254',
			'::1',
		]
		for(const ip of REJECTIONS) {
			await assert.rejects(() => getPublicAddresses(ip))
		}
	})

	it('should prevent SSRF via safeFetch', async() => {
		const REJECTIONS = [
			'http://169.254.169.254/latest/meta-data/',
			'http://127.0.0.1/',
			'http://localhost:8001/',
			'http://localtest.me/',
			'http://10.0.0.1/',
			'http://192.168.1.1/',
			'http://[::1]/',
			'http://[fd00:ec2::254]/',
			'http://0.0.0.0/',
			'http://0.1.2.3/',
			'http://192.0.0.1/',
			'http://[2002:7f00:1::]/',
			'http://[::ffff:127.0.0.1]/',
			'http://[64:ff9b::7f00:1]/',
			'file:///etc/passwd',
			'ftp://example.com/',
		]
		for(const url of REJECTIONS) {
			await assert.rejects(
				() => safeFetch(url, { signal: AbortSignal.timeout(1000) }),
				AttestorError
			)
		}
	})

	it('should allow public URLs via safeFetch', async() => {
		const res = await safeFetch(
			'https://www.google.com/robots.txt',
			{ signal: AbortSignal.timeout(10_000) }
		)
		assert.equal(res.status, 200)
		await res.body?.cancel()
	})

	describe('matchesHostPattern', () => {
		const CASES: { pattern: string, host: string, expected: boolean }[] = [
			// exact match
			{ pattern: 'api.slack.com', host: 'api.slack.com', expected: true },
			{ pattern: 'api.slack.com', host: 'other.slack.com', expected: false },
			{ pattern: 'api.slack.com', host: 'slack.com', expected: false },

			// case-insensitive
			{ pattern: 'API.Slack.com', host: 'api.slack.COM', expected: true },
			{ pattern: '*.Slack.com', host: 'API.slack.COM', expected: true },

			// leading-wildcard, single subdomain
			{ pattern: '*.slack.com', host: 'api.slack.com', expected: true },
			// leading-wildcard, nested subdomain
			{ pattern: '*.slack.com', host: 'a.b.slack.com', expected: true },
			// leading-wildcard matches apex
			{ pattern: '*.slack.com', host: 'slack.com', expected: true },
			// leading-wildcard rejects sibling/super domain
			{ pattern: '*.slack.com', host: 'notslack.com', expected: false },
			{ pattern: '*.slack.com', host: 'slack.com.evil.com', expected: false },
			{ pattern: '*.slack.com', host: 'example.com', expected: false },

			// wildcard only matches as a leading label — not a substring match
			{ pattern: 'api.*.com', host: 'api.slack.com', expected: false },
			{ pattern: 'slack*', host: 'slackapi', expected: false },
		]

		for(const { pattern, host, expected } of CASES) {
			it(`pattern="${pattern}" host="${host}" -> ${expected}`, () => {
				assert.equal(matchesHostPattern(pattern, host), expected)
			})
		}
	})
})
