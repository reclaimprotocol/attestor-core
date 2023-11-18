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


type instagramFollowersParams = {
    userName: string
	followers: number
};

type instagramFollowersSecretParams = {
  cookie: string
};

const HOST = 'www.instagram.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/'

const instagramFollowers: Provider<instagramFollowersParams, instagramFollowersSecretParams> = { hostPort: HOSTPORT, areValidParams(params): params is instagramFollowersParams {
	return typeof params.userName === 'string' && typeof params.followers === 'number'
},
createRequest({ cookie }, {userName}) {
	const data = [
		`GET /${userName} HTTP/1.1`,
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
assertValidProviderReceipt(receipt, { userName, followers }) {


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

	const pattern = new RegExp(`<meta property="og:description" content="${followers} Followers.*${userName}`)
    const match = bodyStr.match(pattern)
    console.log("🚀 ~ file: instagram-followers.ts:90 ~ assertValidProviderReceipt ~ match:", match)

	if(!match){
		throw new Error(`User doesn't have ${followers} followers`)
	}

},
}

export default instagramFollowers