/**
 * Verify the domains from google-domains
 */
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

type GoogleDomains = {
	domainList: string
}

type GoogleDomainSecretParams = {
	/** cookie string for authentication */
    userIdNumber: string
    xsrfToken: string
	cookieStr: string
}

// where to send the HTTP request
const HOST = 'domains.google.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/l/api/batch?brt=120'

const googleDomains: Provider<GoogleDomains, GoogleDomainSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is GoogleDomains {
		return typeof params.domainList === 'string'
	},
	createRequest({ userIdNumber, xsrfToken, cookieStr }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
		const bodyValue = `[["/","8195db10d0f1431daee46749a97137e8",[[1696478400000000,1696532400000000,[[88]]]]],null,[120,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,[${userIdNumber}]]]`
		const data = [
			`POST ${PATH} HTTP/1.1`,
			`Host: ${HOST}`,
			'Accept: application/json, text/plain, */*',
			'Accept-Language: en-GB,en;q=0.9',
			'Connection: close',
			'cookie:' + cookieStr,
			'Content-Type: application/json;charset=UTF-8',
			`Content-Length: ${bodyValue.length}`,
			'x-framework-xsrf-token:' + xsrfToken,
			`\r\n${bodyValue}`,
		].join('\r\n')

		// find the Token string and redact it
		const cookieStartIndex = data.indexOf(cookieStr)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookieStr.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { domainList }) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'post') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)

		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}


		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		try {
			const resBody = uint8ArrayToStr(res.body).slice(6)
			const parsedBody = JSON.parse(resBody)
			const allDomainNames = parsedBody[0][5][parsedBody[0][5].length - 1][0]
			let finalDomainList = ''
			for(let i = 0; i < allDomainNames.length; i++) {
				if(i === allDomainNames.length - 1) {
					finalDomainList += allDomainNames[i][0]
				} else {
					finalDomainList += allDomainNames[i][0] + ' '
				}
			}

			if(finalDomainList !== domainList) {
				throw new Error(`Invalid domain list: ${finalDomainList} does not match ${domainList}`)
			}

		} catch(error) {
			throw new Error(error)
		}
	},
}

export default googleDomains
