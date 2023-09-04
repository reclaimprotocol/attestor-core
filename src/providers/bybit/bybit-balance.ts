/**
 * Use the Bybit API to get the balance of the user
 * and prove that they have certain funds in their account
 * https://bybit-exchange.github.io/docs/v3/intro
 * https://api2.bybit.com//v3/private/cht/asset-common/total-balance?quoteCoin=BTC&balanceType=1' // API
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'

type BybitBalanceParams = {
    balance: number
}

type BybitBalanceSecretParams = {
	userToken: string
}

// where to send the HTTP request
// const HOST = 'api2.bybit.com' // API

//https://api2.bybit.com/v3/private/cht/asset-common/total-balance?quoteCoin=BTC&balanceType=1

const HOST = 'api2.bybit.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
// const URL = '/v3/private/cht/asset-common/total-balance?quoteCoin=BTC&balanceType=1' // API
const METHOD = 'GET'
const URL = '/v3/private/cht/asset-common/total-balance?quoteCoin=BTC&balanceType=1'

const bybitBalance: Provider<BybitBalanceParams, BybitBalanceSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is BybitBalanceParams {
		return typeof params.balance === 'number'
	},
	createRequest({ userToken }) {
		// serialise the HTTP request
		const uriEncodedToken = encodeURIComponent(userToken)
		const url = URL
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: */*',
			'user-agent: reclaim/1.0.0',
			'Content-Length: 0',
			`usertoken: ${userToken}`,
			'Connection: close',
			'\r\n'
		].join('\r\n')
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

		// Convert Response to string and then to Int
		const bodyStr = JSON.parse(res.body.toString())
		const userBalance = (bodyStr.result.originTotalBalance)
		console.log('userBalance:', parseFloat(userBalance).toFixed(2))

		//  check if the userBalance is undefined
		if(!userBalance) {
			throw new Error('Invalid_cookie')
		}

		const percentageDifference = Math.abs((parseFloat(userBalance) - balance) / balance) * 100

		// Check if the percentage difference < 2 % else throw an error
		if(percentageDifference > 2) {
			throw new Error(`User does not have a balance equal to ${balance}`)
		  }
	},
}

export default bybitBalance