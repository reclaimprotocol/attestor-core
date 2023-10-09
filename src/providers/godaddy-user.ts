/**
 * Godaddy Professional Email
 *
 * https://eu1.myprofessionalmail.com/appsuite/api/account
 */
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type GoDaddyLoginParams = {
	emailAddress: string
	region: string
}

type GoDaddyLoginSecretParams = {
	cookieStr: string
	encQueryParams: string
}

// where to send the HTTP request
const HOST = (region: string) => `${region}.myprofessionalmail.com`
const HOSTPORT = (params: GoDaddyLoginParams) => `${HOST(params.region)}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'
const URL = '/appsuite/api/account'

const goDaddyLogin: Provider<GoDaddyLoginParams, GoDaddyLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is GoDaddyLoginParams {
		return typeof params.emailAddress === 'string' && typeof params.region === 'string'
	},
	createRequest({ cookieStr, encQueryParams }, { region }) {
		// serialise the HTTP request
		const endpoint = URL + '?' + encQueryParams
		const data = [
			`${METHOD} ${endpoint} HTTP/1.1`,
			'Host: ' + HOST(region),
			'cookie: ' + cookieStr,
			'Connection: close',
			'Content-Length: 0',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const tokenStartIndex = data.indexOf(cookieStr)
		const encParamsStartIndex = data.indexOf(encQueryParams)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + cookieStr.length,
				},
				{
					fromIndex: encParamsStartIndex,
					toIndex: encParamsStartIndex + encQueryParams.length,
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, params) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT(params)) {
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

		// now we parse the HTTP response & check
		// if the emailAddress returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromReceipt(receipt)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		// parse the body & try to find the email add
		// that the user provided in the parameters
		const json = JSON.parse(uint8ArrayToStr(res.body))
		const resAddr = json?.data?.[0]?.[0]
		if(resAddr !== params.emailAddress) {
			throw new Error(`Email "${params.emailAddress}" could not be matched`)
		}
	},
}

export default goDaddyLogin