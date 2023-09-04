/**
 * Number of followers on medium
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'

type MediumFollowersCountParams = {
  username: string
  followersCount: number
};

type MediumFollowersCountSecretParams = {
  cookie: string
};

const HOST = 'medium.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const mediumFollowersCount: Provider<MediumFollowersCountParams, MediumFollowersCountSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is MediumFollowersCountParams {
		return (
			typeof params.username === 'string' &&
      params.username !== '' &&
      typeof params.followersCount === 'number' &&
      params.followersCount >= 0
		)
	},
	createRequest(secretParams, params) {

		const data = [
			`GET ${params.username} HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: close',
			'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			`cookie: ${secretParams.cookie};`,
			// 'User-Agent: reclaim/1.0.0',
			'\r\n',
		].join('\r\n')

		// Find the cookie and redact it
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

		if(!req.url.startsWith(params.username)) {
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

		const followersCountRegex = /\d+ Follower/g
		const followersCount = bodyStr.match(followersCountRegex)

		let resfollowersCount = 0
		if(followersCount) {
			resfollowersCount = parseInt(followersCount[0].split(' ')[0])
		}

		if(resfollowersCount !== params.followersCount) {
			throw new Error('Followers count not equal to user specified value')
		}

	},
}

export default mediumFollowersCount