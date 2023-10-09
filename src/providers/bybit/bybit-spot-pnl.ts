/**
 * Use the Bybit API to get the PnL of the user
 * https://bybit-exchange.github.io/docs/v3/intro
 * https://api2.bybit.com/spot/api/assetProfit/realTimeProfitDetail?days=7 // API
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'

type BybitSpotPnlParams = {
    profitPercentage: number
}

type BybitSpotPnlSecretParams = {
	userToken: string
}

// where to send the HTTP request
// const HOST = 'api2.bybit.com' // API

//https://api2.bybit.com/v3/private/cht/asset-common/total-balance?quoteCoin=BTC&balanceType=1

const HOST = 'api2.bybit.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/spot/api/assetProfit/realTimeProfitDetail?days=7'

const bybitSpotPnl: Provider<BybitSpotPnlParams, BybitSpotPnlSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is BybitSpotPnlParams {
		return typeof params.profitPercentage === 'number'
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
			`usertoken: ${uriEncodedToken}`,
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
	assertValidProviderReceipt(receipt, { profitPercentage }) {
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

		const bodyStr = JSON.parse(uint8ArrayToStr(res.body))
		const resProfitPercentage = (parseFloat(bodyStr.result.cumulationprofitRate))

		//  check if the userBalance is undefined
		if(resProfitPercentage === undefined) {
			throw new Error('Invalid_cookie')
		}

		const percentageDifference = Math.abs((resProfitPercentage - profitPercentage))

		// Throw an error if the percentagDifference is greater than 2%
		if(percentageDifference > 2) {
			throw new Error(`User does not have a PnL equal to ${profitPercentage}`)
		  }
	},
}

export default bybitSpotPnl