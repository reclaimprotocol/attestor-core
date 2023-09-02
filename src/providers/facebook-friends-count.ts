/**
 * Number of friends on facebook
 */

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type FacebookFreindsCountParams = {
  userURL: string
  friendsCount: number
};

type FacebookFreindsCountSecretParams = {
  cookie: string
};

const HOST = 'www.facebook.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const facebookFriendsCount: Provider<FacebookFreindsCountParams, FacebookFreindsCountSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is FacebookFreindsCountParams {
		return (
			typeof params.userURL === 'string' &&
      params.userURL !== '' &&
      typeof params.friendsCount === 'number' &&
      params.friendsCount >= 0
		)
	},
	createRequest(secretParams, params) {

		const strRequest = [
			`GET ${params.userURL} HTTP/1.1`,
			'Host: www.facebook.com',
			'authority: www.facebook.com',
			'Connection: close',
			'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			`cookie: ${secretParams.cookie};`,
			'Accept-Encoding: identity',
			'User-Agent: reclaim/1.0.0',
			'\r\n',
		].join('\r\n')

		// Find the cookie and redact it
		const data = Buffer.from(strRequest)
		const cookieStartIndex = data.indexOf(secretParams.cookie)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + secretParams.cookie.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, params) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(params.userURL)) {
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

		const bodyStr = res.body.toString()

		const friendsCountRegex = /\d+ friends/g
		const friends = bodyStr.match(friendsCountRegex)

		let resFriendsCount = 0
		if(friends) {
			resFriendsCount = parseInt(friends[0].split(' ')[0])
		}

		if(resFriendsCount !== params.friendsCount) {
			throw new Error('Friends count not equal to user specified value')
		}

	},
}

export default facebookFriendsCount