import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { gunzipSync } from '../../utils'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

// params for the request that will be publicly available
// contains the userId of the logged in user
type TinderMatchCountLoginParams = {
  userId: string
  matchCount: number
};


// these would contain fields that are to be hidden from the public,
// including the witness
type TinderMatchCountLoginSecretParams = {
  /** cookie string for authentication */
  token: string
};

// where to send the HTTP request
const HOST = 'api.gotinder.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/v2/matches?locale=en-GB&count=60&is_tinder_u=false'

const TinderMatchCount: Provider<
  TinderMatchCountLoginParams,
  TinderMatchCountLoginSecretParams
> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is TinderMatchCountLoginParams {
		return (
			typeof params.userId === 'string' &&
      params.userId !== '' &&
      typeof params.matchCount === 'number' &&
      params.matchCount >= 0
		)
	},
	createRequest({ token }) {
		const data = [
			`GET ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			`X-Auth-Token: ${token}`,
			'Connection: close',
			'User-Agent: reclaim/1.0.0',
			'Accept-Encoding: gzip, deflate',
			'\r\n',
		].join('\r\n')

		const tokenStartIndex = data.indexOf(token)

		return {
			data,
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + token.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { matchCount }) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		let html: string
		if(res.headers['content-encoding'] === 'gzip') {
			const buf = Buffer.from(res.body)
			html = gunzipSync(buf).toString()
		} else {
			html = res.body.toString()
		}

		const data = JSON.parse(html)
		const resMatchCount = data?.data?.matches?.length ?? 0
		if(resMatchCount < matchCount) {
			throw new Error('Match count less than user specified value')
		}

	},
}

export default TinderMatchCount
