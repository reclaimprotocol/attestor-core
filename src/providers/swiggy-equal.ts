/**
 * For Swiggy Equal users to prove their usership on swiggy
 *
 * https://www.swiggy.com/
 *
*/

import buffer from 'buffer'
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
	cookieStr = 'deviceId=s%3A3f66aaf6-9641-4603-94cb-98f2c3097fda.A5ZYFWTjrcVWanGnjTmXAKXj7zsxnPTIBJ7llvMO22U; tid=s%3Aaf76efbb-8f80-4c3b-9e99-7fadbc4f94f4.kGc6BX4c4ZO0cfS94FI%2FS9qe99uAwIm%2F7rHa5YGfUvQ; versionCode=1200; platform=web; subplatform=mweb; statusBarHeight=0; bottomOffset=0; genieWebTrackEnabled=false; accessibility-enabled=false; _ga_0N81HC0898=GS1.1.1693325465.1.0.1693325465.0.0.0; _gcl_au=1.1.1169789793.1693325465; __SW=JN1_FgwcGOb_ndZvjM-g6AgvPrrI-AW7; _device_id=8f2f586f-b5c9-3458-fc4b-a52dee5ebdeb; fontsLoaded=1; WZRK_G=12365b67800f4cc59bc635ff17464668; _gid=GA1.2.998696106.1694074614; swgy_logout_clear=1; _sid=97b9b904-914a-464d-86cd-f531d6eda217; _gat_0=1; _is_logged_in=1; _session_tid=1cb14bebddf69aeb763ef5e94fa393df14816553e4baea44ed374d633dded0b766c3dc6007a5003dbc91168a7291a3fe1233ad910811e419855f55b7a6bc60bccabdccadddc16c795847fc178320ed95e81be0e01098485fc12724713fde8461ac6832f1c21f05dae9089fafd4690bae; _gat_UA-53591212-4=1; _ga_4BQKMMC7Y9=GS1.2.1694108151.5.0.1694108151.60.0.0; userLocation=%7B%22lat%22%3A%2212.921745051133614%22%2C%22lng%22%3A%2277.645626924932%22%2C%22address%22%3A%22Agara%20Village%2C%201st%20Sector%2C%20HSR%20Layout%2C%20Bengaluru%2C%20Karnataka%2C%20India%22%2C%22area%22%3A%22Agara%20Village%22%2C%22id%22%3A%22336718256%22%7D; adl=true; WZRK_S_W86-ZZK-WR6Z=%7B%22p%22%3A2%2C%22s%22%3A1694108109%2C%22t%22%3A1694108109%7D; _ga_34JYJ0BCRN=GS1.1.1694108105.9.1.1694108163.0.0.0; _ga=GA1.1.988806284.1693325465'
	const strRequest = [
		'GET /dapi/order/all?order_id= HTTP/1.1',
		'Host: www.swiggy.com',
		'Connection: close',
		'cookie:' + cookieStr,
		'user-agent: reclaim/0.0.1',
		'Accept-Encoding: gzip, deflate',
		'\r\n',
	].join('\r\n')
	const data = buffer.Buffer.from(strRequest)

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
		const buf = buffer.Buffer.from(res.body)
		html = gunzipSync(buf).toString()
	} else {
		html = res.body.toString()
	}

	const data = JSON.parse(html)
	delete data.csrfToken

	// Check if the following account is in the response
	if(JSON.stringify(data) !== userData) {
		throw new Error('User data did not match at witness')
	}

},
}

export default swiggyUser