/**
 * Verify HackerEarth user's username
 *
 * https://www.hackerearth.com/users/profile-settings/
 *
*/


import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'


type HackerEarthUserParams = {
	username: string
};

type HackerEarthUserSecretParams = {
  cookie: string
};

const HOST = 'www.hackerearth.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/users/profile-settings/'

const hackerEarthUser: Provider<HackerEarthUserParams, HackerEarthUserSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is HackerEarthUserParams {
		return typeof params.username === 'string'
	},
	createRequest({ cookie }) {
		const data = [
			`GET ${URL} HTTP/1.1`,
			`Host: ${HOST}`,
			'Connection: close',
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
	assertValidProviderReceipt(receipt, { username }) {


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

		const bodyStr = res.body.toString()

		// Check if the following account is in the response
		if(!bodyStr.includes(`username: "${username}"`)) {
			throw new Error(`User is not a owner of Account ${username}`)
		}

	},
}

export default hackerEarthUser


