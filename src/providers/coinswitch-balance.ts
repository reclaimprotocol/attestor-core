/**
 * Use the Coinswitch API to get the balance of the user
 * and prove that their balance on it
 *
 * https://coinswitch.co/pro/api/v1/cspro/portfolio_data// API
 */

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type CoinswitchBalanceParams = {
    balance: number
}

type CoinswitchBalanceSecretParams = {
	cookieStr: string
}

// where to send the HTTP request

const HOST = 'coinswitch.co'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'POST'
const URL = '/pro/api/v1/cspro/portfolio_data'

const coinswitchBalance: Provider<CoinswitchBalanceParams, CoinswitchBalanceSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is CoinswitchBalanceParams {
		return typeof params.balance === 'number'
	},
	createRequest({ cookieStr }) {
		// serialise the HTTP request
		const uriEncodedToken = encodeURIComponent(cookieStr)
		const url = URL
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: st=${cookieStr};`,
			'referer: https://coinswitch.co/pro/portfolio',
			'user-agent: reclaim/1.0.0',
			'Content-Length: 0',
			'Connection: close',
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
	assertValidProviderReceipt(receipt, { balance }) {
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

		// Convert Response to string and check the balance of the user
		const bodyStr = JSON.parse(uint8ArrayToStr(res.body))
		const userData = bodyStr['data']
		const userBalance = parseFloat(parseFloat(userData[userData.length - 1].current_value).toFixed(2))

		const percentageDifference = Math.abs((userBalance - balance) / balance) * 100

		// As crypto prices change, userBalance will also change. There may be slight differences between the prices,
		// so we need to ensure that the difference remains within the acceptable range,
		// If the percentage difference between prices exceeds 2%, an error is thrown.
		if(percentageDifference > 2) {
			throw new Error(`User does not have a balance of ${balance} Indian rupees`)
		}


	},
}

export default coinswitchBalance

