// Loom provider to prove that you own a certain loom account
// This works by sending a request to loom.com/profile,
// which will redirect you to loom.com/profile/{{userId}}

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'


// params for the request that will be publicly available
// contains the userId of the logged in user
type LoomUserIdParams = {
	userId: string
}

// params required to generate the http request to Loom
// these would contain fields that are to be hidden from the public,
// including the witness
type LoomLoginSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

// where to send the HTTP request
const HOST = 'www.loom.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/profile/'

const loomUser: Provider<LoomUserIdParams, LoomLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is LoomUserIdParams {
		return (
			typeof params.userId === 'string'
		)
	},
	createRequest({ cookieStr }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
		const data = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: keep-alive',
			`cookie: ${cookieStr}`,
			'User-Agent: reclaim/1.0.0',
			'Accept-Encoding: gzip, deflate',
			'\r\n'
		].join('\r\n')

		// find the cookie string and redact it
		const cookieStartIndex = data.indexOf(cookieStr)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookieStr.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { userId }) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(
			receipt.transcript
		)

		if(!res.headers['content-type']?.startsWith('text/')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		// www.loom.com/profile will redirect to loom.com/profile/{{userid}}
		// check for status code to be 302: redirection
		if(res.statusCode !== 302) {
			throw new Error(`Invalid status code: ${res.statusCode}. Expected 302`)
		}

		// check if userid is the same as that /profile will redirect to
		if(res.headers['location'] !== `${PATH}${userId}`) {
			throw new Error(`Invalid profile redirect ${PATH}${userId}. Found ${res.headers['location']}`)
		}

	},
}

export default loomUser
