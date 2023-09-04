/**
 * Verify spotify username
 *
 * https://www.spotify.com/api/account-settings/v1/profile
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'

type SpotifyUserameParams = {
	userName: string
}

type SpotifyUserNameSecretParams = {
	token: string
}

// where to send the HTTP request
const HOST = 'www.spotify.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'
const URL = '/api/account-settings/v1/profile'

const spotifyUserName: Provider<SpotifyUserameParams, SpotifyUserNameSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is SpotifyUserameParams {
		return typeof params?.userName === 'string'
	},
	createRequest({ token }) {
		// serialise the HTTP request
		const url = URL
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: sp_dc=${token};`,
			'accept: */*',
			'user-agent: reclaim/1.0.0',
			'Content-Length: 0',
			'Connection: close',
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

		// now we parse the HTTP response
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		const json = JSON.parse(res.body.toString())
		const resUserName = json.profile?.username
		if(resUserName !== userName) {
			throw new Error('Username does not match')
		}
	},
}

export default spotifyUserName