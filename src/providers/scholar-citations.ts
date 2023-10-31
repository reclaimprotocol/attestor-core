import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { gunzipSync, uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type ScholarGoogleParams = {
    citations: number
}

type ScholarGoogleSecretParams = {
    cookieStr: string
}

const HOST = 'scholar.google.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/scholar?scilib=2'

const scholarGoogle: Provider<ScholarGoogleParams, ScholarGoogleSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is ScholarGoogleParams {
		return (
			typeof params.citations === 'number'
		)
	},
	createRequest({ cookieStr }) {
		const data = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: keep-alive',
			`cookie: ${cookieStr}`,
			'User-Agent: reclaim/1.0.0',
			'Accept-Encoding: gzip, deflate',
			'Refresh: 0',
			'\r\n'
		].join('\r\n')

		const cookieStartIndex = data.indexOf(cookieStr)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + cookieStr.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { citations }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid url: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

		if(!res.headers['content-type']?.startsWith('text/html')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		let html: string
		if(res.headers['content-encoding'] === 'gzip') {
			const buf = Buffer.from(res.body)
			html = gunzipSync(buf).toString()
		} else {
			html = uint8ArrayToStr(res.body)
		}

		const citationsRegexp = /class="gs_or_nvi">Cited by (\d)+<\/a>/g
		const matchArray = [...html.matchAll(citationsRegexp)]

		if(matchArray.length === 0) {
			throw new Error('No citations found')
		}

		let citationsFound = 0
		for(let i = 0; i < matchArray.length; i++) {
			citationsFound += parseInt(matchArray[i][1])
		}

		if(citationsFound !== citations) {
			throw new Error(`Mismatch in citation count found: ${citationsFound}`)
		}
	}
}

export default scholarGoogle