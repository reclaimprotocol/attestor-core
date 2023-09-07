import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'
import { buildQueryString, DEFAULT_QUERY_STRING } from './utils'
type OneOmgParams = {
  data: Record<string, unknown>
  queryString: Record<string, string>
};

type OneMgSecretParams = {
  session: string
};

const HOST = 'www.1mg.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`
const PATH = '/labs_api/v4/bookings'

const oneMg: Provider<OneOmgParams, OneMgSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is OneOmgParams {
		return true
	},
	createRequest({ session }, { queryString }) {
		const cookie = `session=${session};`

		const requestPath = buildQueryString(PATH, {
			...DEFAULT_QUERY_STRING,
			...queryString,
		})

		const data = [
			`GET ${requestPath} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: application/json, text/plain, */*',
			`cookie: ${cookie}`,
			'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
			'\r\n',
		].join('\r\n')
		const cookieStartIndex = data.indexOf(cookie)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookie.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { data: dataParam }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)

		if(res.statusCode !== 200) {
			throw new Error(
				`Invalid Login: ${res.statusCode} received. Try checking cookies.`
			)
		}

		let data: { orders: unknown }

		try {
			const newData = new Uint8Array(res.body)
			const body = new TextDecoder().decode(newData)

			data = JSON.parse(body) as { orders: unknown }

			if(JSON.stringify(data.orders) !== JSON.stringify(dataParam)) {
				throw new Error('Invalid data')
			}
		} catch(error) {
			throw new Error(`Invalid response body: ${error.message}`)
		}
	},
}

export default oneMg
