import { DEFAULT_PORT, RECLAIM_USER_AGENT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'
import { buildQueryString, DEFAULT_QUERY_STRING } from './utils'

// s%3AmAtGh8CWflttFQtu4FSfJ_VZ5ccTwUM_.k9yql43Kf5Jv2T4uMFF6GZGnLpDskcRdTMxXLvO8%2Blk;

type MmtParams = {
  data: string
  queryString: Record<string, string>
};

type MmtSecretParams = {
  mmtAuth: string
};

const HOST = 'supportz.makemytrip.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`
const PATH =
  '/api/v4/bookingsummary?pageNo=0&status=ALL&searchValue=&region=in&currency=inr&language=eng'

const makeMyTrip: Provider<MmtParams, MmtSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is MmtParams {
		return true
	},
	createRequest({ mmtAuth }) {
		// const requestPath = buildQueryString(PATH, {
		// 	...DEFAULT_QUERY_STRING,
		// 	...{},
		// })

		// console.log("requestpath", requestPath)

		console.log('request path', PATH)

		const data = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: keep-alive',
			'accept: */*',
			'mmt-auth: ' + mmtAuth,
			'\r\n',
		].join('\r\n')
		// temp
		const cookieStartIndex = data.indexOf('Connection')

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + 'Connection'.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { data }) {
		console.log('receipt here', receipt)
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)

		console.log('response here', res)

		if(res.statusCode !== 200) {
			throw new Error('Error occured')
		}

		const body = res.body.toString()

		if(!(body === data)) {
			throw new Error('Invalid data')
		}
	},
}

export default makeMyTrip
