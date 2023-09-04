/**
 * Proves whether a user has more than the specified balance of a token in their binance account
 */
import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { gunzipSync } from '../utils'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'
import HTTP_PROVIDER from './http-provider'

type BinanceAssetBalanceParams = {
  assetName: string
  assetQty: number
};

type BinanceAssetBalanceSecretParams = {
  p20tToken: string
  csrfToken: string
};

const HOST = 'www.binance.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const binanceAssetBalance: Provider<BinanceAssetBalanceParams, BinanceAssetBalanceSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is BinanceAssetBalanceParams {
		return (
			typeof params.assetName === 'string' &&
      params.assetName !== '' &&
      typeof params.assetQty === 'number' &&
      params.assetQty >= 0
		)
	},
	createRequest(secretParams) {
		return HTTP_PROVIDER.createRequest(
			{
				cookieStr: `p20t=${secretParams.p20tToken};`,
			},
			{
				url: 'https://www.binance.com/bapi/asset/v2/private/asset-service/wallet/asset',
				method: 'GET',
				headers: {
					csrftoken: secretParams.csrfToken,
				},
				responseSelections: []
			}
		)
	},
	assertValidProviderReceipt(receipt, params) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith('/bapi/asset/v2/private/asset-service/wallet/asset')) {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// Parse the HTTP response
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		let html: string
		if(res.headers['content-encoding'] === 'gzip') {
			const buf = Buffer.from(res.body)
			html = gunzipSync(buf).toString()
		} else {
			html = res.body.toString()
		}

		const data = JSON.parse(html).data
		let numAssets = 0
		for(let i = 0; i < data.length; i++) {
			const asset = data[i]
			if(asset.asset === params.assetName) {
				numAssets++
				if(parseFloat(asset.amount) < params.assetQty) {
					throw new Error('Asset Qty less than user specified value')
				}
			}
		}

		if(numAssets === 0) {
			throw new Error('Asset Qty less than user specified value')
		}
	},
}

export default binanceAssetBalance