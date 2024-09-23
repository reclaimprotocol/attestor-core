import { strToUint8Array, uint8ArrayToStr } from '@reclaimprotocol/tls'
import { makeTcpTunnel } from 'src/server'
import { logger, makeHttpResponseParser } from 'src/utils'

const DEMO_GEO_LOCATIONS = ['in', 'us']

jest.setTimeout(15_000)

describe('TCP Tunnel', () => {

	it.each([...DEMO_GEO_LOCATIONS, 'none'])('should generate a session using a geoLocation (%s)', async(geoLocation) => {
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
		expect(resParser.res.statusCode).toBe(200)
		const resBody = uint8ArrayToStr(resParser.res.body)
		const resJson = JSON.parse(resBody)

		if(geoLocation === 'none') {
			return
		}

		expect(resJson.country).toBe(
			geoLocation.toUpperCase()
		)
	})

	it('should gracefully fail an invalid geoLocation', async() => {
		await expect(
			makeTcpTunnel({
				host: 'lumtest.com',
				port: 80,
				geoLocation: 'xz',
				logger,
			})
		).rejects.toMatchObject({
			message: /failed with status code: 400/
		})
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