import { DEFAULT_PORT, RECLAIM_USER_AGENT } from '../../config'
import { Provider } from '../../types'
import {
	getCompleteHttpResponseFromTranscript,
	getHttpRequestHeadersFromTranscript,
} from '../../utils/http-parser'
import {
	buildQueryString,
	CLAIM_TYPE,
	DEFAULT_QUERY_STRING,
	getGithubEndpoint,
	GithubClaimType,
	isGithubError,
	isObject,
	isValidResponse,
	SearchQueryObject,
} from './utils'

type GithubParams<T extends GithubClaimType> = {
	/** github `url` type eg: `commits` */
	type: T
	/** repository name eg: {owner}/{repo} */
	repository: string
	/** query string for github search */
	searchQuery: SearchQueryObject
}

type GithubSecretParams = {
	token: string
}

const HOST = 'api.github.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'
const URL = '/search'

const makeGithubProvider = <T extends GithubClaimType>() => <Provider<GithubParams<T>, GithubSecretParams>>{
	hostPort: HOSTPORT,
	areValidParams(params): params is GithubParams<T> {
		const { type, repository, searchQuery } = params
		return (
			CLAIM_TYPE.includes(type as GithubClaimType) &&
				typeof repository === 'string' &&
				repository.split('/').length === 2 &&
				isObject(searchQuery)
		)
	},
	createRequest({ token }, { type, searchQuery, repository }) {

		const endpoint = getGithubEndpoint(type)
		const qs = buildQueryString(
			searchQuery,
			type,
			DEFAULT_QUERY_STRING,
			repository
		)
		const PATH = `${URL}/${endpoint}${qs}`

		const data = [
			`${METHOD} ${PATH} HTTP/1.1`,
			'Host: ' + HOST,
			'Connection: close',
			'Content-Length: 0',
			'X-GitHub-Api-Version: 2022-11-28',
			'Accept: application/vnd.github+json',
			`Authorization: Bearer ${token}`,
			`User-Agent: ${RECLAIM_USER_AGENT}`,
			'\r\n',
		].join('\r\n')

		// find the token and redact it
		const tokenStartIndex = data.indexOf(token)

		return {
			data,
			// anything that should be redacted from the transcript
			// should be added to this array
			redactions: [
				{
					fromIndex: tokenStartIndex,
					toIndex: tokenStartIndex + token.length,
				},
			],
		}
	},
	assertValidProviderReceipt(receipt) {
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

		if(!req.url.startsWith(URL)) {
			throw new Error(`Invalid URL: ${req.url}`)
		}

		// we ensure the connection header was sent as "close"
		// this is done to avoid any possible malicious request
		// that contains multiple requests, but via redactions
		// is spoofed as a single request
		if(req.headers['connection'] !== 'close') {
			throw new Error('Invalid connection header')
		}

		// now we parse the HTTP response & check
		// if the emailAddress returned by the API
		// matches the parameters the user provided
		const res = getCompleteHttpResponseFromTranscript(receipt.transcript)

		if(!res.headers['content-type']?.startsWith('application/json')) {
			throw new Error(`Invalid content-type: ${res.headers['content-type']}`)
		}

		const responseBody = JSON.parse(res.body.toString())

		if(res.statusCode !== 200) {
			if(isGithubError(responseBody)) {
				const errorStr = responseBody?.errors?.length
					? responseBody.errors[0].message
					: responseBody.message

				throw new Error(errorStr)
			}
		}

		if(!isValidResponse(responseBody)) {
			throw new Error(`Invalid Receipt: ${res.statusCode}`)
		}
	},
}

export default makeGithubProvider


