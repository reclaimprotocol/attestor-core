import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getPublicAddresses, matchesHostPattern } from '#src/server/utils/generics.ts'

describe('Misc Tests', () => {
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
