
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'


// params for the request that will be publicly available
// contains the domain list of the logged in user
type NameCheapDomains = {
	domainList: string

}

// params required to generate the http request to NameCheap
// these would contain fields that are to be hidden from the public,
// including the witness
type NameCheapSecretParams = {
	/** bearer token for authentication */
	cookieStr: string
	antiForgeryStr: string
}

// where to send the HTTP request
const HOST = 'ap.www.namecheap.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`


// what API to call
const METHOD = 'POST'
const PATH = '/Domains/GetDomainList'

const nameCheapDomainList: Provider<NameCheapDomains, NameCheapSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is NameCheapDomains {
		return (
			typeof params.domainList === 'string'
		)
	},
	createRequest({ cookieStr, antiForgeryStr }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages
		const bodyVal = JSON.stringify({
			gridStateModel:{
				ServerChunkSize:1000,
				LastAvailableChunkIndex:0,
				IsLazyLoading:true,
				TotalServerItemsCount:null
			},
			isOverViewPage:true,
		})
		const data = [
			`${METHOD} ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: application/json, text/plain, */*',
			'accept-language: en-GB,en-US;q=0.9,en;q=0.8',
			'cookie: ' + cookieStr,
			'content-length: ' + bodyVal.length,
			'Connection: close',
			'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
			'content-type: application/json;charset=UTF-8',
			'_nccompliance: ' + antiForgeryStr,
			`\r\n${bodyVal}`
		].join('\r\n')

		// find the cookie string and redact it
		const cookieStartIndex = data.indexOf(cookieStr)
		const antiForgeryStartIndex = data.indexOf(antiForgeryStr)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookieStr.length
				},
				{
					fromIndex: antiForgeryStartIndex,
					toIndex: antiForgeryStartIndex + antiForgeryStr.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { domainList }) {
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

		const res = getCompleteHttpResponseFromReceipt(
			receipt
		)

		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		try {
			const resBodyStr = uint8ArrayToStr(res.body)
			const pattern = /\"Data\":((.|\s)*?)\,\"Metadata\":/
			const matchPattern = resBodyStr.match(pattern)
			if(matchPattern) {
				const regexPattern = /,{2,}/g
				const replacedString = matchPattern[1].replace(regexPattern, ',')
				const resBody = JSON.parse(replacedString)
				if(resBody?.length) {
					let extractedDomains = ''
					for(var i = 0;i < resBody.length;i++) {
						extractedDomains += (resBody[i][1]) + ','
					}

					if(extractedDomains !== domainList) {
						throw new Error(`Received Domain list ${extractedDomains} does not match expected "${domainList}"`)
					}
				} else if(resBody?.length === 0 && domainList !== '') {
					throw new Error(`Received Domain list ${resBody} does not match`)
				}
			} else {
				throw new Error('Invalid response body from API')
			}
		} catch(error) {
			throw new Error(error)
		}
	},
}

export default nameCheapDomainList


