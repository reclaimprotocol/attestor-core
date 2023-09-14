/**
 * Use the Notion API to get the username of the user
 * to prove they are owners of the same usernname.
 *
 * https://www.notion.so/api/v3/getSpaces
 */
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type NotionUsernameParams = {
    userName: string
}

type NotionUsernameSecretParams = {
    token: string
}

// where to send the HTTP request
const HOST = 'www.notion.so'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'POST'
const URL = '/api/v3/getSpaces'

// Define the provider
const notionUsername: Provider<NotionUsernameParams, NotionUsernameSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is NotionUsernameParams {
		return typeof params.userName === 'string'
	},
	createRequest({ token }) {
		// serialise the HTTP request
		const url = URL
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: token_v2=${token};`,
			'accept: */*',
			'user-agent: reclaim/1.0.0',
			'Connection: close',
			'Content-Length: 0',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const tokenStartIndex = data.indexOf(token)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + token.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { userName }) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== METHOD.toLowerCase()) {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(URL)) {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		// we ensure the connection header was sent as "close"
		// this is done to avoid any possible malicious request
		// that contains multiple requests, but via redactions
		// is spoofed as a single request
		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// now we parse the HTTP response & check
		// if the userName returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		// parse the body & try to find the username
		// inside the JSON response from the API
		const json = JSON.parse(uint8ArrayToStr(res.body))
		const keys = Object.keys(json)
		if(!keys.length) {
			throw new Error('No user details found')
		}

		const firstKey = keys[0]
		const parsedUsername = json[firstKey].notion_user[firstKey].value.name
		if(parsedUsername !== userName) {
			throw new Error(`Username "${parsedUsername}" does not match expected "${userName}"`)
		}
	},
}

export default notionUsername