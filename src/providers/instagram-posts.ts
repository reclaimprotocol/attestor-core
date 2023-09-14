/**
 * Verify the image posts that have been posted
 * over the last week by a user.
 *
 * internal instagram feed API.
 */

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { uint8ArrayToStr } from '../utils'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type InstagramPostsTypeParams = {
	igCDNFileNames: string[] // list of CDN filenames
}

type InstagramPostsTypeSecretParams = {
	cookieStr: string
	csrfToken: string
	username: string
}

// where to send the HTTP request
const HOST = 'www.instagram.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

// what API to call
const METHOD = 'GET'
const URL_BASE = '/api/v1/feed/user'
const URL = (username: string) => `${URL_BASE}/${username}/username/?count=20`

// arr1, arr2: sorted strings
const isArrEq = (arr1: string[], arr2: string[]) => {
	if(arr1.length !== arr2.length) {
		return false
	}

	for(let i = 0; i < arr1.length; i++) {
		if(arr1[i] !== arr2[i]) {
			return false
		}
	}

	return true
}


const instagramUserWeekPost: Provider<InstagramPostsTypeParams, InstagramPostsTypeSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is InstagramPostsTypeParams {
		return typeof params?.igCDNFileNames === 'object'
	},
	createRequest({ cookieStr, csrfToken, username }) {
		// serialise the HTTP request
		const url = URL(username)
		const data = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			`cookie: ${cookieStr}`,
			`x-csrftoken: ${csrfToken}`,
			'x-ig-app-id: 936619743392459',
			'accept: */*',
			'user-agent: reclaim/1.0.0',
			'Content-Length: 0',
			'Connection: close',
			'\r\n'
		].join('\r\n')

		// find the token and redact it
		const tokenStartIndex = data.indexOf(csrfToken)
		const cookieStartIndex = data.indexOf(cookieStr)

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
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + csrfToken.length
				},
			]
		}
	},
	assertValidProviderReceipt(receipt, { igCDNFileNames }) {
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

		if(!req.url.startsWith(URL_BASE)) {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		// we ensure the connection header was sent as "close"
		// this is done to avoid any possible malicious request
		// that contains multiple requests, but via redactions
		// is spoofed as a single request
		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// now we parse the HTTP response
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		const json = JSON.parse(uint8ArrayToStr(res.body))
		if(!json?.hasOwnProperty('items')) {
			throw new Error('json body incorrect')
		}

		const lastweek = new Date()
		lastweek.setDate(lastweek.getDate() - 7)
		const unixTSLowerLimit = Math.floor(lastweek.getTime() / 1000)

		// Extract all media URIs for posts made by the user
		const imgMatchPattern = /\/([0-9a-zA-Z_-]+)\.(heic|jpg|png|jpeg)/
		const resURIFnames: string[] = []
		json['items'].forEach(imgMD => {
			if(imgMD['taken_at'] >= unixTSLowerLimit) {
				// check if media is an image and extract the filename from CDN URL
				if(imgMD?.['media_type'] === 1 && imgMD.hasOwnProperty('image_versions2')) {
					const uri: string = imgMD['image_versions2']?.['candidates']?.[0]?.['url']
					if(uri) {
						const matches = uri.match(imgMatchPattern)
						if(matches?.[1]) {
							resURIFnames.push(matches[1])
						}
					}
				}
			}
		})

		// sort
		resURIFnames.sort()
		igCDNFileNames.sort()

		if(!isArrEq(resURIFnames, igCDNFileNames)) {
			throw new Error('URIs do not match')
		}
	},
}

export default instagramUserWeekPost