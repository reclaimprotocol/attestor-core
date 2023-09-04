// Venmo provider to prove that you have transferred certain amount of money to a certain venmo account
// This works by sending a request to account.venmo.com/api/stories and extracting the details

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'


// params for the request that will be publicly available
// contains the userId of the logged in user
type VenmoTransactionParams = {
	userId: string
    recipientId: string
    amount: string
}

// params required to generate the http request to Venmo
// these would contain fields that are to be hidden from the public,
// including the witness
type VenmoLoginSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
    userId: string
}

// where to send the HTTP request
const HOST = 'account.venmo.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`


// what API to call
const METHOD = 'GET'
const PATH = '/api/stories?feedType=me'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const findMatchingStory = (receiverId: string, senderId: string, amount: string, data: any) => {
	for(const story of data) {
		if(
			story.title?.receiver?.id === receiverId &&
        story.title?.sender?.id === senderId &&
        story.amount === amount
		) {
			return true
		}
	}

	return false
}

const venmoTransaction: Provider<VenmoTransactionParams, VenmoLoginSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is VenmoTransactionParams {
		return (
			typeof params.userId === 'string' && typeof params.recipientId === 'string' && typeof params.amount === 'string'
		)
	},
	createRequest({ cookieStr, userId }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
		const data = [
			`${METHOD} ${PATH}&externalId=${userId} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: */*',
			'accept-language: en-GB,en-US;q=0.9,en;q=0.8',
			`cookie: ${cookieStr};`,
			'Connection: close',
			'\r\n'
		].join('\r\n')

		// find the cookie string and redact it
		const cookieStartIndex = data.indexOf(cookieStr)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookieStr.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { userId, recipientId, amount }) {
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

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		// we ensure the connection header was sent as "close"
		// this is done to avoid any possible malicious request
		// that contains multiple requests, but via redactions
		// is spoofed as a single request
		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(
			receipt.transcript
		)

		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		try {
			const resBody = JSON.parse(res.body.toString())
			if(!findMatchingStory(recipientId, userId, amount, resBody?.stories)) {
				throw new Error('No matching transaction found')
			}
		} catch(error) {
			throw new Error(error)
		}
	},
}

export default venmoTransaction
