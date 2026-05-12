import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getPublicAddresses } from '#src/server/utils/generics.ts'

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
})
