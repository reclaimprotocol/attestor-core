import assert from 'node:assert'
import { describe, it } from 'node:test'

import { makeTcpTunnel } from '#src/server/index.ts'
import { type AttestorError, logger, makeHttpResponseParser, strToUint8Array, uint8ArrayToStr } from '#src/utils/index.ts'

const DEMO_GEO_LOCATIONS = ['in', 'us']
const ALL_LOCATIONS = [...DEMO_GEO_LOCATIONS, 'none']

describe.skip('TCP Tunnel', () => {

	for(const geoLocation of ALL_LOCATIONS) {
		it(`should generate a session using a geoLocation (${geoLocation})`, async() => {
			const resParser = makeHttpResponseParser()

			let resolvePromise: (() => void) | undefined
			let rejectPromise: ((err: Error) => void) | undefined

			const session = await makeTcpTunnel({
				host: 'lumtest.com',
				port: 80,
				geoLocation: geoLocation === 'none' ? '' : geoLocation,
				logger,
				onClose(err) {
					rejectPromise?.(err || new Error('session closed'))
				},
				onMessage(data) {
					resParser.onChunk(data)
					if(resParser.res.complete) {
						resolvePromise?.()
					}
				},
			})

			const waitForRes = new Promise<void>((resolve, reject) => {
				resolvePromise = resolve
				rejectPromise = reject
			})

			const str = 'GET /myip.json HTTP/1.1\r\nHost: lumtest.com\r\n\r\n'
			await session.write(strToUint8Array(str))
			await waitForRes

			await session.close()
			assert.equal(resParser.res.statusCode, 200)
			const resBody = uint8ArrayToStr(resParser.res.body)
			const resJson = JSON.parse(resBody)

			if(geoLocation === 'none') {
				return
			}

			assert.equal(resJson.country, geoLocation.toUpperCase())
		})
	}

	it('should gracefully fail an invalid geoLocation', async() => {
		assert.rejects(
			async() => makeTcpTunnel({
				host: 'lumtest.com',
				port: 80,
				geoLocation: 'xz',
				logger,
			}),
			(err: AttestorError) => {
				assert.match(err.message, /failed with status code: 400/)
				return true
			}
		)
	})

	it('should connect to restricted server', async() => {
		const session = await makeTcpTunnel({
			host: 'servicos.acesso.gov.br',
			port: 80,
			geoLocation: 'US',
			logger,
		})

		await session.close()
	})
})