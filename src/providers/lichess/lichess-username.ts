// The lichess provider aims to prove that you own a lichess username

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToBinaryStr } from '../../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'


// params for the request that will be publicly available
// contains the userId of the logged in user
type LichessUserParams = {
    username: string
}

// params required to generate the http request to Lichess
// these would contain fields that are to be hidden from the public,
// including the witness
type LichessLoginSecretParams = {
    /** cookie string for authentication */
    cookieStr: string
}

// where to send the HTTP request
const HOST = 'lichess.org'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/inbox'

const lichessUsername: Provider<LichessUserParams, LichessLoginSecretParams> = {
	hostPort: HOSTPORT,
	writeRedactionMode: 'zk',
	areValidParams(params): params is LichessUserParams {
		return (
			typeof params.username === 'string'
		)
	},
	createRequest({ cookieStr }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
		const data = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			// "connection: close" ensures the server terminates
			// the connection after the first HTTP request is done.
			// We add this header to prevent the user from creating
			// multiple http requests in the same session
			'Connection: close',
			`cookie: ${cookieStr}`,
			'User-Agent: reclaim/1.0.0',
			'Accept-Encoding: identity',
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
			],
		}
	},
	assertValidProviderReceipt(receipt, { username }) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

		if(res.statusCode === 303) {
			throw new Error(`Invalid Login: ${res.statusCode} received. Try checking cookies.`)
		}

		if(!res.headers['content-type']?.startsWith('text/html')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		const html = uint8ArrayToBinaryStr(res.body)

		const userRegexp = /lichess.load.then\(\(\)\=\>\{lichess.loadEsm\('msg',\{init:\{"data":{"me":{"name":"\w*","id":"\w*"/g

		const matches = html.match(userRegexp)
		const infoStringList = matches?.[0].split('{')?.at(-1)?.split(',')
		const nameString = infoStringList?.[0].split(':')?.[1].replace(/"/g, '')

		if(nameString !== username) {
			throw new Error(`Invalid Username: ${username} doesn't match fetched name ${nameString}`)
		}

	},
}

export default lichessUsername
