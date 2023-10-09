/**
 * For Chess.com app users to prove their Rating on Chess.com
 *
 * https://www.chess.com/
 */


import { DEFAULT_PORT } from '../../config'
import { Provider } from '../../types'
import { uint8ArrayToStr } from '../../utils'
import { getCompleteHttpResponseFromReceipt, getHttpRequestHeadersFromTranscript } from '../../utils/http-parser'


type ChessRatingParams = {
    rating: string
    userName: string
};

type ChessRatingSecretParams = {
  cookie: string
};

const HOST = 'www.chess.com'
const HOSTPORT = `${HOST}:${DEFAULT_PORT}`

const METHOD = 'GET'

const chessRating: Provider<ChessRatingParams, ChessRatingSecretParams> = { hostPort: HOSTPORT, areValidParams(params): params is ChessRatingParams {
	return (
		typeof params.rating === 'string' &&
        typeof params.userName === 'string'
	)
},
createRequest({ cookie }, params) {

	const data = [
		`GET /stats/overview/${params.userName} HTTP/1.1`,
		'Host: www.chess.com',
		'Connection: close',
		'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
		'cookie:' + cookie,
		'user-agent:reclaim/0.0.1',
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
assertValidProviderReceipt(receipt, { rating, userName }) {

	if(receipt.hostPort !== HOSTPORT) {
		throw new Error(`Invalid hostPort: ${receipt.hostPort}`)
	}

	const req = getHttpRequestHeadersFromTranscript(receipt)
	if(req.method !== METHOD.toLowerCase()) {
		throw new Error(`Invalid method: ${req.method}`)
	}

	if(!req.url.startsWith(`/stats/overview/${userName}`)) {
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

	// Convert Response to string and check if the following account is in the response
	const bodyStr = uint8ArrayToStr(res.body)

	// Create regex patterns to extract rating type and value
	const ratingTypePattern = /^(.+)\|/
	const ratingValuePattern = /\|(\d+)$/

	// Extract rating type and value using the regex patterns
	const ratingTypeMatch = rating.match(ratingTypePattern)
	const ratingValueMatch = rating.match(ratingValuePattern)

	if(!ratingTypeMatch || !ratingValueMatch) {
		throw new Error('Invalid rating format')
	}

	const ratingType = ratingTypeMatch[1]
	const ratingValueAsNumber = parseInt(ratingValueMatch[1])


	const pattern = new RegExp(`"${ratingType}":{[^}]*"last_rating":\\s*${ratingValueAsNumber}\\s*,`)
	const match = bodyStr.match(pattern)

	if(!match) {
		throw new Error('User does not hold the Rating')
	}

},
}

export default chessRating

