// The zomato-equal orders provider aims to prove the zomato food orders
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import {
	getCompleteHttpResponseFromReceipt,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

// params for the request that will be publicly available
// contains the url and food userData of the logged in user
type ZomatoOrderParams = {
	url: string
	userData: string
}

// params required to generate the http request to Zomato
// these would contain fields that are to be hidden from the public,
// including the witness
type ZomatoLoginSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

// where to send the HTTP request
const HOST = 'scrape.smartproxy.com'
const API_URL = 'https://zomato.com/webroutes/user/orders?page=1'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`


// what API to call
const METHOD = 'POST'
const PATH = '/v1/tasks'

const extractCookiesFromStr = (cookieStr: string) => {
	const cookies = cookieStr.split(';')
	const cookieDictArr = cookies.map(cookie => {
		const cookieVal = cookie.substring(cookie.indexOf('=') + 1)
		const cookieKey = cookie.split('=')[0]
		return { ['key']: cookieKey, ['value']: cookieVal }
	})
	return cookieDictArr
}


const zomatoOrdersEqual: Provider<ZomatoOrderParams, ZomatoLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is ZomatoOrderParams {
		return true
	},
	createRequest({ cookieStr }) {

		const payloadHeaders = {
			'Accept': '*/*',
			'Accept-Encoding': 'identity',
			'User-Agent': 'reclaim/0.0.1',
			'Content-Length': '0',
		}

		const payloadCookies = extractCookiesFromStr(cookieStr)


		const payload = JSON.stringify({
			'target': 'universal',
			'url': API_URL,
			'headers': payloadHeaders,
			'cookies': payloadCookies,
			'http_method': 'get'
		})

		const data = [
			`${METHOD} ${PATH} HTTP/1.1`,
			`Host: ${HOST}`,
			'accept: application/json',
			'Content-Type: application/json',
			'Connection: close',
			'Authorization: Basic VTAwMDAxMTE3ODQ6cHZxZXdjSzl0cFRvM05iNTZa',
			`Content-Length: ${payload.length}`,
			'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
			'X-Smartproxy-Geo: United States',
			`\r\n${payload}\}`
		].join('\r\n')


		const cookieStrStartIndex = data.indexOf(`${payload}`)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStrStartIndex,
					toIndex: cookieStrStartIndex + `${payload}`.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { userData }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'post') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

		if(res.statusCode !== 200) {
			throw new Error(
				`Invalid Login: ${res.statusCode} received.`
			)
		}


		try {
			// const parsedRes = JSON.stringify(JSON.parse(uint8ArrayToStr(res.body)))
			// const parsedClient = JSON.stringify(JSON.parse(userData))


			// if(parsedRes !== parsedClient) {
			// 	throw new Error('Invalid data')
			// }
		} catch(error) {
			throw new Error(`Invalid response body: ${error.message}`)
		}
	},
}

export default zomatoOrdersEqual