/**
 * Goibibo provider
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'
import HTTP_PROVIDER from '../http-provider'

type GoibiboParams = {
    goTribeDetails: string
}

type GoibiboSecretParams = {
    'bm_sz': string
    'Auth': string
}

const HOST = 'www.goibibo.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'

const goibibo: Provider<GoibiboParams, GoibiboSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is GoibiboParams {
		return typeof params.goTribeDetails === 'string'
	},
	createRequest(secretParams) {

		return HTTP_PROVIDER.createRequest({
			cookieStr: `bm_sz=${secretParams.bm_sz};`,
		}, {
			url: 'https://www.goibibo.com/tripsbackend//v2/bookingsummary',
			method: METHOD,
			headers: {
				'Auth': secretParams.Auth,
			},
			responseSelections: []
		})
	},
	assertValidProviderReceipt(receipt) {
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


		if(!req.url.startsWith('/tripsbackend//v2/bookingsummary')) {
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

		const data = Buffer.from(res.body).toString('utf8')

		if(!data) {
			throw new Error(`Invalid data: ${data}`)
		}

	},
}

export default goibibo