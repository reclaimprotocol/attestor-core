/**
 * Verify the username on soundcloud
 */

import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'

type SoundcloudUsernameParams = {
  username: string
};

type SoundcloudUsernameSecretParams = {
  cookie: string
};

const HOST = 'soundcloud.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const SoundcloudUsername: Provider<SoundcloudUsernameParams, SoundcloudUsernameSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is SoundcloudUsernameParams {
		return (
			typeof params.username === 'string' &&
      params.username !== ''
		)
	},
	createRequest(secretParams) {
		const data = [
			'GET /discover HTTP/1.1',
			'Host: ' + HOST,
			'Connection: close',
			'authority: soundcloud.com',
			'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			'cookie: ' + secretParams.cookie,
			'\r\n',
		].join('\r\n')
		const cookieStartIndex = data.indexOf(secretParams.cookie)

		return {
			data,
			redactions: [
				{
					fromIndex: cookieStartIndex,
					toIndex: cookieStartIndex + secretParams.cookie.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, params) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith('/discover')) {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// Parse the HTTP response
		const res = getCompleteHttpResponseFromReceipt(receipt)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		const bodyStr = res.body.toString()

		const usernameRegex = /"username":"([^"]+)"/g
		const username = bodyStr.match(usernameRegex)

		const resUsername = username !== null ? username[0].split('"')[3] : ''

		if(resUsername !== params.username) {
			throw new Error('Username different from the user specified value')
		}

	},
}

export default SoundcloudUsername