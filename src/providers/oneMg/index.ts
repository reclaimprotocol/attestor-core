import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromReceipt,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'
import { sortedStringify } from './utils'

type OneOmgParams = {
	userData: string
};

type OneMgSecretParams = {
  cookieStr: string
};

const HOST = 'www.1mg.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`
const PATH = '/labs_api/v4/bookings'

const oneMg: Provider<OneOmgParams, OneMgSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is OneOmgParams {
		return true
	},
	createRequest({ cookieStr }) {

		const data = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: application/json, text/plain, */*',
			`cookie: ${cookieStr}`,
			'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
			'\r\n',
		].join('\r\n')
		const cookieStartIndex = data.indexOf(cookieStr)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookieStr.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { userData }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

		if(res.statusCode !== 200) {
			throw new Error(
				`Invalid Login: ${res.statusCode} received. Try checking cookies.`
			)
		}


		try {
			const parsedRes = JSON.parse(JSON.stringify((res.body.toString())))
			const parsedClient = JSON.parse(JSON.stringify(userData))

			const sortedParsedRes = sortedStringify(parsedRes.orders)
			const sortedParsedClient = sortedStringify(parsedClient.orders)

			if(sortedParsedRes !== sortedParsedClient) {
				throw new Error('Invalid data')
			}
		} catch(error) {
			throw new Error(`Invalid response body: ${error.message}`)
		}
	},
}

export default oneMg
