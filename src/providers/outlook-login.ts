/**
 * Outlook OAuth 2.0
 *
 * https://graph.microsoft.com/v1.0/me
 */
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type OutlookLoginParams = {
	emailAddress: string
}

type OutlookLoginSecretParams = {
	token: string
}

// where to send the HTTP request
const HOST = 'graph.microsoft.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'
const URL = '/v1.0/me'

const outlookLogin: Provider<OutlookLoginParams, OutlookLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is OutlookLoginParams {
		return typeof params.emailAddress === 'string'
	},
	createRequest({ token }) {
		// serialise the HTTP request
		// const uriEncodedToken = encodeURIComponent(token)
		const uriEncodedToken = token
		const data = [
			`${METHOD} ${URL} HTTP/1.1`,
			'Host: ' + HOST,
			`Authorization: Bearer ${uriEncodedToken}`,
			'Connection: close',
			'Content-Length: 0',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const tokenStartIndex = data.indexOf(uriEncodedToken)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + uriEncodedToken.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { emailAddress }) {
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
		// if the emailAddress returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		// parse the body & try to find the email add
		// that the user provided in the parameters
		const json = JSON.parse(uint8ArrayToStr(res.body))
		if(json.mail !== emailAddress) {
			throw new Error(`Email "${json.email}" does not match expected "${emailAddress}"`)
		}
	},
}

export default outlookLogin