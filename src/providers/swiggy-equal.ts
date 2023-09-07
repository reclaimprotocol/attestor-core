/**
 * For Swiggy Equal users to prove their usership on swiggy
 *
 * https://www.swiggy.com/
 *
*/


import { gunzipSync } from 'zlib'
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../utils/http-parser'

type SwiggyUserParams = {
    userData: string
};

type SwiggyUserSecretParams = {
    cookieStr: string
};

const HOST = 'www.swiggy.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/dapi/order/all?order_id='

const swiggyUser: Provider<SwiggyUserParams, SwiggyUserSecretParams> = { hostPort: HOSTPORT, areValidParams(params): params is SwiggyUserParams {
	return typeof params.userData === 'string'
},
createRequest({ cookieStr }) {
	const strRequest = [
		'GET /dapi/order/all?order_id= HTTP/1.1',
		'Host: www.swiggy.com',
		'Connection: close',
		'cookie:' + cookieStr,
		'user-agent: reclaim/0.0.1',
		'Accept-Encoding: gzip, deflate',
		'\r\n',
	].join('\r\n')
	const data = Buffer.from(strRequest)

	// Find the cookie and redact it
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

	const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
	if(req.method !== METHOD.toLowerCase()) {
		throw new Error(`Invalid method: ${req.method}`)
	}

	if(!req.url.startsWith(URL)) {
		throw new Error(`Invalid URL: ${req.url}`)
	}

	if(req.headers['connection'] !== 'close') {
		throw new Error('Invalid connection header')
	}

	// Parse the HTTP response
	const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
	if(res.statusCode !== 200) {
		throw new Error(`Invalid status code: ${res.statusCode}`)
	}

	let html: string
	if(res.headers['content-encoding'] === 'gzip') {
		const buf = Buffer.from(res.body)
		html = gunzipSync(buf).toString()
	} else {
		html = res.body.toString()
	}

	const data = JSON.parse(html)
	delete data.csrfToken

	// Check if the following account is in the response

	if(JSON.stringify(data) === userData) {
		throw new Error('User data did not match at witness')
	}

},
}

export default swiggyUser