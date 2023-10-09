/**
 * For instagram users to prove they own an account
 *
 * https://www.instagram.com/
 *
*/


import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'


type InstagramUserParams = {
    userName: string
};

type InstagramUserSecretParams = {
  cookie: string
};

const HOST = 'www.instagram.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/'

const instagramUser: Provider<InstagramUserParams, InstagramUserSecretParams> = { hostPort: HOSTPORT, areValidParams(params): params is InstagramUserParams {
	return typeof params.userName === 'string'
},
createRequest({ cookie }) {
	const data = [
		'GET / HTTP/1.1',
		'Host: www.instagram.com',
		'Connection: close',
		'authority: www.instagram.com',
		'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
		'cookie:' + cookie,
		'user-agent: reclaim/0.0.1',
		'\r\n',
	].join('\r\n')


	// Find the cookie and redact it
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
assertValidProviderReceipt(receipt, { userName }) {


	if(receipt.hostPort !== HOSTPORT) {
		throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
	}

	const req = getHttpRequestHeadersFromTranscript(receipt)
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
	const res = getCompleteHttpResponseFromReceipt(receipt)
	if(res.statusCode !== 200) {
		throw new Error(`Invalid status code: ${res.statusCode}`)
	}

	// Convert Response to string and check if the following account is in the response
	const bodyStr = uint8ArrayToStr(res.body)

	// Check if the following account is in the response

	if(!bodyStr.includes(`\\\"username\\\":\\\"${userName}\\\",\\\"badge_count\\\":`)) {
		throw new Error(`User is not a owner of Account ${userName}`)
	}

},
}

export default instagramUser