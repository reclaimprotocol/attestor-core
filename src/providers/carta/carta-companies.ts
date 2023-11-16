/**
 * Use the Carta API to get the username of the user
 * to prove they are owners of the same usernname.
 *
 * https://www.carta.so/api/v3/getSpaces
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'

type CartaUsernameParams = {
	esopCompanies: string
}

type CartaUsernameSecretParams = {
	userId: string
	cookieStr: string
	csrfToken: string
}

// where to send the HTTP request
const HOST = 'app.carta.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'


// Define the provider
const cartaEsopsCompanies: Provider<CartaUsernameParams, CartaUsernameSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is CartaUsernameParams {
		return typeof params.esopCompanies === 'string'
	},
	createRequest({ userId, cookieStr, csrfToken }) {
		// serialise the HTTP request
		const url = `/api/investors/portfolio/fund/${userId}/list/`
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: ${cookieStr}`,
			'accept: application/json, text/plain, */*',
			'accept-language: en-GB,en-US;q=0.9,en;q=0.8',
			'Connection: close',
			`referer: https://app.carta.com/investors/individual/${userId}/portfolio/`,
			`x-csrftoken: ${csrfToken}`,
			'\r\n'
		].join('\r\n')

		// find the token and redact it
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
	assertValidProviderReceipt(receipt, { esopCompanies }) {
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

		// we ensure the connection header was sent as "close"
		// this is done to avoid any possible malicious request
		// that contains multiple requests, but via redactions
		// is spoofed as a single request
		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// now we parse the HTTP response & check
		// if the userName returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromReceipt(receipt)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		// parse the body & try to find the username
		// inside the JSON response from the API
		const json = JSON.parse(uint8ArrayToStr(res.body))
		if(json?.count === undefined) {
			throw new Error(`Invalid JSON response: ${json}`)
		}

		if(json.count === 0) {
			if(esopCompanies !== '') {
				throw new Error(`No ESOPs found for user matching ${esopCompanies}`)
			}
		} else {
			let fetchedEsopCompanies = ''
			for(let i = 0; i < json.count; i++) {
				fetchedEsopCompanies += json.results.companies[i].name
				if(i < json.count - 1) {
					fetchedEsopCompanies += ', '
				}
			}

			if(esopCompanies !== fetchedEsopCompanies) {
				throw new Error(`ESOPs found for user ${fetchedEsopCompanies} do not match the expected ${esopCompanies}`)
			}
		}
	},
}

export default cartaEsopsCompanies