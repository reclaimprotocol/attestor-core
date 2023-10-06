/**
 * Verify the Email Address from ZOHO Profile API Endpoint
 *
 * https://accounts.zoho.in/webclient/v1/account/self/user/self
 */
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils';
import {
	getCompleteHttpResponseFromReceipt,
	getHttpRequestHeadersFromTranscript,
} from '../utils/http-parser'

type ZohoParams = {
  //Things that I want to verify
  email: string
};

type ZohoSecretParams = {
  token: string
};

// where to send the HTTP request
const HOST = 'accounts.zoho.in'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`


// what API to call
const METHOD = 'GET'
const PATH = '/webclient/v1/account/self/user/self'

const zohoEmail: Provider<ZohoParams, ZohoSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is ZohoParams {
		return typeof params.email === 'string'
	},
	createRequest({ token }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages

		const data = [
			`${METHOD} ${PATH} HTTP/1.1`,
			`Host: ${HOST}`,
			'accept: application/json, */*',
			'Connection: close',
			'Cookie: ' + token,
			'User-Agent: reclaim/1.0.0',
			'\r\n',
		].join('\r\n')

		// find the Token string and redact it
		const tokenStartIndex = data.indexOf(`${token}`)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + `${token}`.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { email }) {
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

		// now we parse the HTTP response & check
		// if the address returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromReceipt(receipt)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		const resBody = JSON.parse(uint8ArrayToStr(res.body))
		if(resBody?.user?.User?.primary_email !== email) {
			throw new Error(`Invalid email: ${resBody?.user?.User?.primary_email} could not be matched with ${email}`)
		}
	},
}

export default zohoEmail