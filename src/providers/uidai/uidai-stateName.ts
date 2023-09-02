/**
 * Verify the State from aadhar card
 */
import { gunzipSync } from 'zlib'
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

type UidaiParams = {
  //Things that I want to verify
  stateName: string
};

type UidaiSecretParams = {
  uid: string
  token: string
};

// where to send the HTTP request
const HOST = 'tathya.uidai.gov.in'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/ssupService/api/demographics/request/v4/profile'

const UidaiAadhaarState: Provider<UidaiParams, UidaiSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is UidaiParams {
		return typeof params.stateName === 'string'
	},
	createRequest({ uid, token }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages

		const payload = JSON.stringify({ uidNumber: uid })

		const strRequest = [
			`POST ${PATH} HTTP/1.1`,
			`Host: ${HOST}`,
			'Accept: application/json, text/plain',
			'Accept-Language: en_IN',
			`Authorization: ${token}`,
			'Connection: close',
			'Content-Type: application/json',
			`Content-Length: ${payload.length}`,
			'appID: SSUP',
			'Accept-Encoding: gzip, deflate, br',
			`\r\n\{"uidNumber":"${uid}"}`,
		].join('\r\n')

		// find the Token string and redact it
		const data = Buffer.from(strRequest)
		const tokenStartIndex = data.indexOf(`${token}`)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + `${token}`.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt, { stateName }) {
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

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)

		if(res.statusCode === 303) {
			throw new Error(
				`Invalid Login: ${res.statusCode} received. Try checking token. It might be stale.`
			)
		}

		let html: string
		if(res.headers['content-encoding'] === 'gzip') {
			const buf = Buffer.from(res.body)
			html = gunzipSync(buf).toString()
		} else {
			html = res.body.toString()
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		const json = JSON.parse(html)
		if(!('responseData' in json)) {
			throw new Error('Invalid response returned from server!')
		}

		if(!json.responseData.stateName) {
			throw new Error('No State was found in the response data!')
		}

		if(json.responseData.stateName !== stateName) {
			throw new Error(
				`Invalid State: State doesn't match fetched State ${json.responseData.stateName}`
			)
		}
	},
}

export default UidaiAadhaarState
