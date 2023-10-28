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
const HOST = 'zomato-creatoros.koyeb.app'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const zomatoOrdersEqual: Provider<ZomatoOrderParams, ZomatoLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is ZomatoOrderParams {
		return typeof params.userData === 'string'
	},
	createRequest(secretParams, params) {

		const data = [
			`GET ${params.url} HTTP/1.1`,
			`Host: ${HOST}`,
			'Accept: */*',
			'Accept-Encoding: identity',
			`Cookie: ${secretParams.cookieStr}`,
			'User-Agent: reclaim/0.0.1',
			'Content-Length: 0',
			'\r\n',
		].join('\r\n')
		const cookieStartIndex = data.indexOf(secretParams.cookieStr)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + secretParams.cookieStr.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { userData, url }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(url)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

		if(res.statusCode !== 200) {
			throw new Error(
				`Invalid Login: ${res.statusCode} received.`
			)
		}


		const parsedRes = JSON.parse(uint8ArrayToStr(res.body))
		const parsedClient = JSON.parse(userData)

		delete parsedRes.sections.SECTION_USER_ORDER_HISTORY.noOrderButton.pageToLoad
		delete parsedClient.sections.SECTION_USER_ORDER_HISTORY.noOrderButton.pageToLoad

		for(const orderId in parsedRes.entities.ORDER) {
			if(parsedRes.entities.ORDER[orderId].hasOwnProperty('resInfo') && parsedRes.entities.ORDER[orderId].resInfo.hasOwnProperty('thumb')) {
			  delete parsedRes.entities.ORDER[orderId].resInfo.thumb
			}
		  }

		  for(const orderId in parsedClient.entities.ORDER) {
			if(parsedClient.entities.ORDER[orderId].hasOwnProperty('resInfo') && parsedClient.entities.ORDER[orderId].resInfo.hasOwnProperty('thumb')) {
			  delete parsedClient.entities.ORDER[orderId].resInfo.thumb
			}
		  }

		try {
			if(JSON.stringify(parsedRes) !== JSON.stringify(parsedClient)) {
				throw new Error('Invalid data')
			}
		} catch(error) {
			throw new Error(`Invalid response body: ${error.message}`)
		}
	},
}

export default zomatoOrdersEqual
