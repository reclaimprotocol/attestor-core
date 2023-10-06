/**
 * Number of a particular stock in their Groww account
 */
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type GrowwParams = {
  stockIsin: string
  stockQty: number
}

type GrowwSecretParams = {
  authToken: string
}

// where to send the HTTP request
const HOST = 'groww.in'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'
const URL = '/v1/api/stocks_router/v4/holding'

const GrowwStocksCount: Provider<GrowwParams, GrowwSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is GrowwParams {
		return (
			typeof params.stockIsin === 'string' &&
      params.stockIsin !== '' &&
      typeof params.stockQty === 'number' &&
      params.stockQty >= 0
		)
	},
	createRequest(secretParams) {
		// serialise the HTTP request
		const data = [
			`GET ${URL} HTTP/1.1`,
			'Host: ' + HOST,
			`authorization: Bearer ${secretParams.authToken}`,
			'accept: application/json, text/plain, */*',
			'accept-encoding: deflate, identity',
			'Connection: close',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const authTokenStartIndex = data.indexOf(secretParams.authToken)
		// const accessTokenStartIndex = data.indexOf(accessToken)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: authTokenStartIndex,
					toIndex: authTokenStartIndex + secretParams.authToken.length
				},
			]
		}
	},
	assertValidProviderReceipt(receipt, { stockIsin, stockQty }) {
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

		const html = uint8ArrayToStr(res.body)

		const data = JSON.parse(html)
		const holdings = data?.holdings
		let resHoldingQty = 0
		for(let i = 0; i < holdings.length; i++) {
			const holding = holdings[i].holding
			if(holding.symbolIsin === stockIsin) {
				if(parseInt(holding.holdingQty) !== stockQty) {
					throw new Error('Stock Qty not equal to the user specified value')
				}
			} else {
				resHoldingQty = resHoldingQty + 1
			}
		}

		if(resHoldingQty === holdings.length) {
			throw new Error('Stock Qty not equal to the user specifed value')
		}
	},
}

export default GrowwStocksCount