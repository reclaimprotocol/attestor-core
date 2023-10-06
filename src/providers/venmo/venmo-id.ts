// Venmo provider to prove that you own a certain venmo account
// This works by sending a request to account.venmo.com/_next/data/X4CQ5-Nj20dBzlA63J4Ee/en/settings/profile.json and extracting the details

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import {
	getCompleteHttpResponseFromReceipt,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'


// params for the request that will be publicly available
// contains the userId of the logged in user
type VenmoUserIdParams = {
	userId: string
}

// params required to generate the http request to Venmo
// these would contain fields that are to be hidden from the public,
// including the witness
type VenmoLoginSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

// where to send the HTTP request
const HOST = 'account.venmo.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`


// what API to call
const METHOD = 'GET'
const PATH = '/_next/data/X4CQ5-Nj20dBzlA63J4Ee/en/settings/profile.json'

const venmoUser: Provider<VenmoUserIdParams, VenmoLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is VenmoUserIdParams {
		return (
			typeof params.userId === 'string'
		)
	},
	createRequest({ cookieStr }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
		const data = [
			`${METHOD} ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: */*',
			'accept-language: en-GB,en-US;q=0.9,en;q=0.8',
			`cookie: ${cookieStr};`,
			'Connection: close',
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
		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== METHOD.toLowerCase()) {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		// we ensure the connection header was sent as "close"
		// this is done to avoid any possible malicious request
		// that contains multiple requests, but via redactions
		// is spoofed as a single request
		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		try {
			const resBody = JSON.parse(uint8ArrayToStr(res.body))
			if(resBody?.pageProps?.id !== userId) {
				throw new Error(`UserId "${resBody?.pageProps?.id}" does not match expected "${userId}"`)
			}
		} catch(error) {
			throw new Error(error)
		}
	},
}

export default venmoUser
