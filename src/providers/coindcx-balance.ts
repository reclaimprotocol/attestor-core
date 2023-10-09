/**
 * Use the Coindcx API to get the balance of the user
 * and prove that their balance on it
 *
 * https://api.coindcx.com/api/v2/wallets/portfolio API
 */

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type CoindcxBalanceParams = {
    assetName: string
    balance: number
}

type CoindcxBalanceSecretParams = {
	AuthToken: string
}

// where to send the HTTP request


const HOST = 'api.coindcx.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/api/v2/wallets/portfolio'

const coindcxBalance: Provider<CoindcxBalanceParams, CoindcxBalanceSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is CoindcxBalanceParams {
		return (
			typeof params.assetName === 'string' &&
      params.assetName !== '' &&
      typeof params.balance === 'number' &&
      params.balance >= 0
		)
	},
	createRequest({ AuthToken }) {
		// serialise the HTTP request
		const uriEncodedToken = encodeURIComponent(AuthToken)
		const url = URL
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`authorization: Bearer ${uriEncodedToken};`,
			'user-agent: reclaim/1.0.0',
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
	assertValidProviderReceipt(receipt, { assetName, balance }) {
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
		const assetWallet = bodyStr.wallets.find((wallet: any) => {
			return wallet.currency_short_name === assetName
		})
		if(assetWallet === undefined) {
			throw new Error('Asset does not exist on CoinDCX')
		}

		// Extract the balance of Asset
		const assetBalance = parseFloat(assetWallet.balance)


		if(assetBalance !== balance) {
			throw new Error('Asset qty is less than the specified value')
		}


	},
}

export default coindcxBalance
