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
				proxySessionId: '',
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

	it('should gracefully fail an invalid geoLocation or ip session id', async() => {
		assert.rejects(
			async() => makeTcpTunnel({
				host: 'lumtest.com',
				port: 80,
				geoLocation: 'xz',
				proxySessionId: '',
				logger,
			}),
			(err: AttestorError) => {
				assert.match(err.message, /failed with status code: 400/)
				return true
			}
		)

		assert.rejects(
			async() => makeTcpTunnel({
				host: 'lumtest.com',
				port: 80,
				geoLocation: '',
				proxySessionId: 'xz',
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
			proxySessionId: '',
			logger,
		})

		await session.close()
	})

	it('should connect from same ip using a proxySessionId', async() => {
		const proxySessionId = 'abcd12345'

		const getResponseBySessionId = async(proxySessionId: string) => {
			const resParser = makeHttpResponseParser()

			let resolvePromise: (() => void) | undefined
			let rejectPromise: ((err: Error) => void) | undefined

			const session = await makeTcpTunnel({
				host: 'api.ipify.org',
				port: 80,
				geoLocation: 'IN',
				proxySessionId: proxySessionId,
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

			const str = 'GET /?format=json HTTP/1.1\r\nHost: api.ipify.org\r\n\r\n'
			await session.write(strToUint8Array(str))
			await waitForRes

			await session.close()
			assert.equal(resParser.res.statusCode, 200)
			const resBody = uint8ArrayToStr(resParser.res.body)
			const resJson = JSON.parse(resBody)
			return resJson
		}

		const resJson1 = await getResponseBySessionId(proxySessionId)
		assert.ok(resJson1.ip)

		const resJson2 = await getResponseBySessionId(proxySessionId)
		assert.ok(resJson2.ip)

		const resJson3 = await getResponseBySessionId(proxySessionId)
		assert.ok(resJson3.ip)

		assert.strictEqual(resJson1.ip, resJson2.ip, 'IP should be consistent across sessions')
		assert.strictEqual(resJson2.ip, resJson3.ip, 'IP should be consistent across sessions')
	})
})