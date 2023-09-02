import { gunzipSync } from 'zlib'
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

// params for the request that will be publicly available
// contains the minimum amount of the logged in user
type SwiggyOrderThreshold = {
  orderCount: number
};

// params required to generate the http request to Swiggy
// these would contain fields that are to be hidden from the public,
// including the witness
type SwiggyLoginSecretParams = {
  /** cookie string for authentication */
  cookieStr: string
};

const HOST = 'www.swiggy.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/dapi/order/all?order_id='

const SwiggyTotalOrder: Provider<
  SwiggyOrderThreshold,
  SwiggyLoginSecretParams
> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is SwiggyOrderThreshold {
		return typeof params.orderCount === 'number' && params.orderCount >= 0
	},
	createRequest({ cookieStr }) {
		const strRequest = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: close',
			`cookie: ${cookieStr}`,
			'User-Agent: reclaim/1.0.0',
			'Accept-Encoding: gzip, deflate',
			'\r\n',
		].join('\r\n')
		const data = Buffer.from(strRequest)
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
	assertValidProviderReceipt(receipt, { orderCount }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		let html: string
		if(res.headers['content-encoding'] === 'gzip') {
			const buf = Buffer.from(res.body)
			html = gunzipSync(buf).toString()
		} else {
			html = res.body.toString()
		}

		const data = JSON.parse(html)
		if(data?.data?.orders?.length === 'undefined') {
			throw new Error("Can't fetch order count")
		}

		const resOrderCount = data?.data?.orders?.length
		if(resOrderCount !== orderCount) {
			throw new Error("OrderCount Doesn't match")
		}
	},
}

export default SwiggyTotalOrder
