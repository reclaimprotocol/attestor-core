/**
 * For HackerRank app users to prove they have an account on HackerRank
 *
 * https://www.hackerrank.com/
 */


import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'


type HackerRankUserParams = {
    userName: string
};

type HackerRankUserSecretParams = {
	token: string
};

const HOST = 'www.hackerrank.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/settings/account'


const hackerRankUsername: Provider<HackerRankUserParams, HackerRankUserSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is HackerRankUserParams {
		return typeof params.userName === 'string'
	},
	createRequest({ token }) {
		// serialise the HTTP request
		const url = URL
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: _hrank_session=${token};`,
			'accept: */*',
			'user-agent: reclaim/1.0.0',
			'Connection: close',
			'Content-Length: 0',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const tokenStartIndex = data.indexOf(token)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + token.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { userName }) {
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

		// now we parse the HTTP response & check
		// if the userName returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('text/html')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		// parse the body & try to find the username
		// inside the response from the endpoint
		const resBody = res.body.toString()
		const regex = /"username":"(.*?)"/
		const regexMatches = resBody.match(regex)
		if(!regexMatches) {
			throw new Error('No Username found')
		}

		const extractedUserName = regexMatches[1]
		if(extractedUserName !== userName) {
			throw new Error(`Extracted "${extractedUserName}" Username does not match with expected "${userName}" Username`)
		}
	},
}

export default hackerRankUsername

