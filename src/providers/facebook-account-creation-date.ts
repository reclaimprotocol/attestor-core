import { DEFAULT_PORT } from '../config'
import { Provider } from '../types'
import { getCompleteHttpResponseFromTranscript, getHttpRequestHeadersFromTranscript } from '../utils/http-parser'

type FacebookAccountCreationDateParams = {
  joinedAt: string
};

type FacebookAccountCreationDateSecretParams = {
  cookie: string
};

const HOST = 'm.facebook.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const FACEBOOK_EDIT_PAGE = 'https://m.facebook.com/profile/intro/edit/about/';

const facebookAccountCreationDate: Provider<FacebookAccountCreationDateParams, FacebookAccountCreationDateSecretParams> = {
	hostPort: HOSTPORT,
	areValidParams(params): params is FacebookAccountCreationDateParams {
		return (
			typeof params.joinedAt === 'string' 	
        )
	},
	createRequest(secretParams, params) {

		const data = [
			`GET ${FACEBOOK_EDIT_PAGE} HTTP/1.1`,
			'Host: m.facebook.com',
			'authority: m.facebook.com',
			'Connection: close',
			'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			`cookie: ${secretParams.cookie};`,
			'Accept-Encoding: identity',
			'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
            'sec-fetch-mode: navigate',
			'\r\n',
		].join('\r\n')

		// Find the cookie and redact it
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

		const req = getHttpRequestHeadersFromTranscript(receipt.transcript)
		if(req.method !== 'get') {
			throw new Error(`Invalid method: ${req.method}`)
		}

		if(!req.url.startsWith(FACEBOOK_EDIT_PAGE)) {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// Parse the HTTP response
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)
		if(res.statusCode !== 200) {
			throw new Error(`Invalid status code: ${res.statusCode}`)
		}

		const bodyStr = res.body.toString()
		const pattern = /<div class="_277w">Joined (\w+) (\d{4})<\/div>/;

		const match = bodyStr.match(pattern);

        if(!match) throw new Error('Could not find joined date');

        const joinedAt = `${match[1]} ${match[2]}` ;

		if(joinedAt !== params.joinedAt) {
			throw new Error('Joined date not equal to user specified value')
		}

	},
}

export default facebookAccountCreationDate