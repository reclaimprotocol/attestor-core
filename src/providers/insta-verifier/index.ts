import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import {
	getCompleteHttpResponseFromReceipt,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'
import { InstaVerifierResponseType, isLikesInRange } from './utils'

const HOST = 'www.instagram.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/'

type InstaVerifierParams = {
  likesCount: number
  audioClipId: string
  username: string
};

type InstaVerifierSecretParams = {
  cookie: string
};

const instaVerifier: Provider<InstaVerifierParams, InstaVerifierSecretParams> =
  {
  	hostPort: HOSTPORT,
  	areValidParams(params): params is InstaVerifierParams {
  		return true
  	},

  	// https://www.instagram.com/api/v1/feed/user/aman/username/?count=12
  	createRequest({ cookie }, { username }) {
  		const PATH = `/api/v1/feed/user/${username}/username/?count=100`

  		const data = [
  			`GET ${PATH} HTTP/1.1`,
  			'Host: www.instagram.com',
  			'Connection: close',
  			'authority: www.instagram.com',
  			'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  			'cookie:' + cookie,
  			'user-agent: reclaim/0.0.1',
  			'x-ig-app-id: 936619743392459',
  			'\r\n',
  		].join('\r\n')

  		// Find the cookie and redact it
  		const cookieStartIndex = data.indexOf(cookie)

  		return {
  			data,
  			redactions: [
  				{
  					fromIndex: cookieStartIndex,
  					toIndex: cookieStartIndex + cookie.length,
  				},
  			],
  		}
  	},
  	assertValidProviderReceipt(receipt, { audioClipId, likesCount, username }) {
  		if(receipt.hostPort !== HOSTPORT) {
  			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
  		}

  		const req = getHttpRequestHeadersFromTranscript(receipt)
  		if(req.method !== METHOD.toLowerCase()) {
  			throw new Error(`Invalid method: ${req.method}`)
  		}

  		if(!req.url.startsWith(URL)) {
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

  		const bodyStr = uint8ArrayToStr(res.body)

  		const parsedBody = JSON.parse(bodyStr) as InstaVerifierResponseType

  		let found = false
  		for(const item of parsedBody.items) {
  			if(
  				item.clips_metadata.music_info.music_asset_info.audio_cluster_id ===
            audioClipId &&
          isLikesInRange(item.like_count, likesCount, 10) &&
          parsedBody.user.username === username
  			) {
  				found = true
  				break
  			}
  		}

  		if(!found) {
  			throw new Error('Invalid response')
  		}
  	},
  }

export default instaVerifier
