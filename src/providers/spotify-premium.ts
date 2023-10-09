/**
 * Prove that a spotify user is a premium member
 *
 * https://developer.spotify.com/documentation/web-api
 * https://api.spotify.com/v1/me
 */

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type SpotifyPremiumParams = {}

type SpotifyPremiumSecretParams = {
	token: string
}

// where to send the HTTP request
// const HOST = 'api.spotify.com' // API
const HOST = 'www.spotify.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
// const URL = '/v1/me' // API
const METHOD = 'GET'
const URL = '/us/api/account/v1/datalayer/'

const spotifyPremium: Provider<SpotifyPremiumParams, SpotifyPremiumSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is SpotifyPremiumParams {
		return Object.keys(params).length === 0
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
	assertValidProviderReceipt(receipt, {}) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt)
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
		const res = getCompleteHttpResponseFromReceipt(receipt)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		const json = JSON.parse(uint8ArrayToStr(res.body))
		const productType = json.currentPlan
		if(productType !== 'premium') {
			throw new Error('User is not a premium member')
		}
	},
}

export default spotifyPremium