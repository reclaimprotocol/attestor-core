/**
 * Verify the Mobile number from aadhar card
 */
import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { gunzipSync, uint8ArrayToStr } from '../../utils'
import {
	getCompleteHttpResponseFromReceipt,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'

type UidaiParams = {
  //Things that I want to verify
  mobile: string
};

type UidaiSecretParams = {
  uid: string
  token: string
};

// where to send the HTTP request
const HOST = 'tathya.uidai.gov.in'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const PATH = '/ssupService/api/demographics/request/v4/profile'

const UidaiAadhaarPhone: Provider<UidaiParams, UidaiSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is UidaiParams {
		return typeof params.mobile === 'string'
	},
	createRequest({ uid, token }) {
		// this is a simple http request construction.
		// see https://developer.mozilla.org/en-US/docs/Web/HTTP/Messages

		const payload = JSON.stringify({ uidNumber: uid })
		const data = [
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
	assertValidProviderReceipt(receipt, { mobile }) {
		// ensure the request was sent to the right place
		if(receipt.hostPort !== HOSTPORT) {
			throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
		}

		// parse the HTTP request & check
		// the method, URL, headers, etc. match what we expect
		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== 'post') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(PATH)) {
			throw new Error(`Invalid path: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromReceipt(receipt)

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
			html = uint8ArrayToStr(res.body)
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		const json = JSON.parse(html)
		if(!('responseData' in json)) {
			throw new Error('Invalid response returned from server!')
		}

		if(!json.responseData.mobile) {
			throw new Error('No Mobile no was found in the response data!')
		}

		if(json.responseData.mobile !== mobile) {
			throw new Error(
				`Invalid Mobile Number: Mobile Number doesn't match fetched mobile number ${json.responseData.mobile}`
			)
		}
	},
}

export default UidaiAadhaarPhone
