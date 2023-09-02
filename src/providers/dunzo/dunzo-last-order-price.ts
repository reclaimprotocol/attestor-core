/**
 * Verify latest dunzo order at the period of the order
 * https://www.dunzo.com/api/v0/tasks/?type=&page=1
 *
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'
import getTopOrderValues, { deliveredCondition } from './utils'

type DunzoLastOrderParams = {
	value: number
}

type DunzoLastOrderSecretParams = {
	cookieStr: string
}

// where to send the HTTP request
const HOST = 'www.dunzo.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'
const URL = '/api/v0/tasks/?type=&page=1'

const dunzoLastOrder: Provider<DunzoLastOrderParams, DunzoLastOrderSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is DunzoLastOrderParams {
		return typeof params?.value === 'number'
	},
	createRequest({ cookieStr }) {
		// serialise the HTTP request
		const url = URL
		const strRequest = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: ${cookieStr};`,
			'accept: application/json, text/plain, */*',
			'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
			'Content-Length: 0',
			'Connection: close',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const data = Buffer.from(strRequest)
		const tokenStartIndex = data.indexOf(cookieStr)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + cookieStr.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { value }) {
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

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		const json = JSON.parse(res.body.toString())
		let totalValue: number
		const k = 1

		try {
			const orderValues = getTopOrderValues(json.data?.tasks, deliveredCondition, k)
			if(orderValues.length !== k) {
				throw new Error('number of orders required don\'t match')
			}

			totalValue = orderValues.reduce((sum, val) => sum + val, 0)
		} catch(err) {
			throw err
		}

		if(totalValue !== value) {
			throw new Error('Invalid purchase value')
		}
	},
}

export default dunzoLastOrder