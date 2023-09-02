/**
 * Prove whether a user has a proton mail account
 */

import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { gunzipSync } from '../utils'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type ProtonMailParams = {
  email: string
};


type ProtonMailSecretParams = {
  auth: string
  xPmUid: string
};

const HOST = 'mail.proton.me'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/api/core/v4/users'

const ProtonMail: Provider<ProtonMailParams, ProtonMailSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is ProtonMailParams {
		return (
			typeof params.email === 'string' &&
      params.email !== ''
		)
	},
	createRequest(secretParams) {

		const url = URL
		const strRequest = [
			`${METHOD} ${url} HTTP/1.1`,
			'Host: ' + HOST,
			'accept: */*',
			'user-agent: reclaim/1.0.0',
			'Connection: close',
			`x-pm-uid: ${secretParams.xPmUid}`,
			`cookie: ${secretParams.auth}`,
			'x-pm-appversion: web-mail@1000.0.23.1',
			'\r\n'
		].join('\r\n')


		// Find the cookie and redact it
		const data = Buffer.from(strRequest)
		const AuthStartIndex = data.indexOf(secretParams.auth)
		const xPmUidStartIndex = data.indexOf(secretParams.xPmUid)

		return {
			data,
			redactions: [
				{ fromIndex:xPmUidStartIndex, toIndex:xPmUidStartIndex + secretParams.xPmUid.length },
				{ fromIndex:AuthStartIndex, toIndex:AuthStartIndex + secretParams.auth.length },
			],
		}
	},
	assertValidProviderReceipt(receipt, { email }) {
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}


		if(!req.url.startsWith('/api/core/v4/users')) {
			throw new Error(`Invalid URL: ${req.url}`)
		}


		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}


		let html: string
		if(res.headers['content-encoding'] === 'gzip') {
			const buf = Buffer.from(res.body)
			html = gunzipSync(buf).toString()
		} else {
			html = res.body.toString()
		}


		const data = JSON.parse(html)
		const resEmail = data.User.Email
		if(resEmail !== email) {
			throw new Error('Email does not match')
		}
	},
}

export default ProtonMail