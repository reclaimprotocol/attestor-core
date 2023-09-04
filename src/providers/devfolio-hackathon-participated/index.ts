/**
 * Verify the total no of Hackathons Participated
 * https://api.devfolio.co/api/users/${username}/primary_stats
 *
 */
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { gunzipSync } from '../../utils'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

// params for the request that will be publicly available
// contains the userId of the logged in user
type DevfolioHackthonsParams = {
  username: string
  hackathonCount: number
};

// these would contain fields that are to be hidden from the public,
// including the witness
type DevfolioHackthonsSecretParams = {
  /** cookie string for authentication */
  cookieStr: string
};

// where to send the HTTP request
const HOST = 'api.devfolio.co'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const DevfolioHackathonsCount: Provider<
  DevfolioHackthonsParams,
  DevfolioHackthonsSecretParams
> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is DevfolioHackthonsParams {
		return (
			typeof params.username === 'string' &&
      params.username !== '' &&
      typeof params.hackathonCount === 'number'
		)
	},
	createRequest({ cookieStr }, { username }) {
		const data = [
			`GET /api/users/${username}/primary_stats HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: close',
			'cookie: ' + cookieStr,
			'User-Agent: reclaim/1.0.0',
			'Accept-Encoding: gzip, deflate',
			'\r\n',
		].join('\r\n')

		const tokenStartIndex = data.indexOf(cookieStr)

		return {
			data,
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + cookieStr.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { hackathonCount }) {
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
		const resHackathonCount = data?.hackathons ?? 0
		if(resHackathonCount !== hackathonCount) {
			throw new Error('Values doesnt match')
		}
	},
}

export default DevfolioHackathonsCount
