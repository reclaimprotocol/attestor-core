import assert from 'node:assert'
import { it, mock } from 'node:test'

mock.module('re2', { defaultExport: undefined })

it('compiles RE2-compatible response patterns with the native fallback', async() => {
	const { makeRegex } = await import('#src/providers/http/utils.ts')
	const regexp = makeRegex('(?<total_content_views>.*?}]}})')

	assert.equal(regexp.constructor.name, 'RegExp')
	assert.equal(
		regexp.exec('123}]}}')?.groups?.total_content_views,
		'123}]}}'
	)
})
