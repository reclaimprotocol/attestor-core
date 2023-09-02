/**
 * Mock login provider for testing;
 * mimicks the Google login provider
 *
 * essentially, if you provide token = "foo",
 * then it'll return a JSON with "emailAddress" = "foo@mock.com"
 */
import { Provider } from '../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type MockLoginParams = {
	emailAddress: string
}

type MockLoginSecretParams = {
	token: string
}

const HOSTPORT = 'localhost:8881'

const mockLogin: Provider<MockLoginParams, MockLoginSecretParams> = {
	hostPort: HOSTPORT,
	additionalClientOptions: {
		verifyServerCertificate: false
	},
	areValidParams(params): params is MockLoginParams {
		return typeof params.emailAddress === 'string'
	},
	createRequest({ token }) {
		const strRequest = [
			'GET /me?return=emailAddress HTTP/1.1',
			'Host: localhost',
			`Authorization: Bearer ${token}`,
			'Content-Length: 0',
			'\r\n'
		].join('\r\n')

		const data = Buffer.from(strRequest)
		const tokenStartIndex = data.indexOf(token)

		return {
			data,
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + token.length
				}
			]
		}
	},
	assertValidProviderReceipt(receipt, { emailAddress }) {
		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)

		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(req.url !== '/me?return=emailAddress') {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)

		if(res.headers['content-type'] !== 'application/json') {
			throw new Error('Invalid content type')
		}

		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		const json = JSON.parse(res.body.toString())
		if(json.emailAddress !== emailAddress) {
			throw new Error(`Invalid email address: ${json.emailAddress}`)
		}
	},
}

export default mockLogin