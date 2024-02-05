import { concatenateUint8Arrays, strToUint8Array } from '@reclaimprotocol/tls'
import { DEFAULT_PORT, RECLAIM_USER_AGENT } from '../../config'
import { TranscriptMessageSenderType } from '../../proto/api'
import { ArraySlice, Provider } from '../../types'
import {
	extractApplicationDataMsgsFromTranscript,
	findIndexInUint8Array,
	getHttpRequestHeadersFromTranscript,
	REDACTION_CHAR_CODE,
	uint8ArrayToBinaryStr,
	uint8ArrayToStr,
} from '../../utils'
import { HTTPProviderParams, HTTPProviderSecretParams } from './types'
import {
	buildHeaders,
	convertResponsePosToAbsolutePos,
	extractHTMLElement,
	extractJSONValueIndex,
	makeRegex,
	normaliseParamsToV2,
	parseHttpResponse,
} from './utils'

export * from './types'

const OK_HTTP_HEADER = 'HTTP/1.1 200'

const HTTP_PROVIDER: Provider<HTTPProviderParams, HTTPProviderSecretParams> = {
	hostPort(params) {
		const { host } = new URL(params.url)
		if(!host) {
			throw new Error('url is incorrect')
		}

		return host
	},
	writeRedactionMode(params) {
		return ('writeRedactionMode' in params)
			? params.writeRedactionMode
			: undefined
	},
	geoLocation(params) {
		return ('geoLocation' in params)
			? params.geoLocation
			: undefined
	},
	areValidParams(params): params is HTTPProviderParams {
		return (
			typeof params.url === 'string' &&
            (params.method === 'GET' || params.method === 'POST') &&
            ((Array.isArray(params.responseSelections) && params.responseSelections.length > 0) || (Array.isArray(params.responseMatches) && params.responseMatches.length > 0))
		)
	},
	createRequest(secretParams, params) {
		if(
			!secretParams.cookieStr &&
            !secretParams.authorisationHeader &&
            !secretParams.headers
		) {
			throw new Error('auth parameters are not set')
		}

		const pubHeaders = params.headers || {}
		const secHeaders = { ...secretParams.headers }
		if(secretParams.cookieStr) {
			secHeaders['Cookie'] = secretParams.cookieStr
		}

		if(secretParams.authorisationHeader) {
			secHeaders['Authorization'] = secretParams.authorisationHeader
		}

		const hasUserAgent = Object.keys(pubHeaders)
			.some(k => k.toLowerCase() === 'user-agent')
		if(!hasUserAgent) {
			//only set user-agent if not set by provider
			pubHeaders['User-Agent'] = RECLAIM_USER_AGENT
		}

		const hostPort = this.hostPort instanceof Function
			? this.hostPort(params)
			: this.hostPort
		const { pathname } = new URL(params.url)
		const searchParams = params.url.includes('?') ? params.url.split('?')[1] : ''
		console.log('Params URL:', params.url, 'Path:', pathname, 'Query:', searchParams.toString())
		const body =
            params.body instanceof Uint8Array
            	? params.body
            	: strToUint8Array(params.body || '')
		const contentLength = body.length
		const reqLine = `${params.method} ${pathname}${searchParams?.length ? '?' + searchParams : ''} HTTP/1.1`
		const secHeadersList = buildHeaders(secHeaders)
		console.log('Request line:', reqLine)
		const httpReqHeaderStr = [
			reqLine,
			`Host: ${hostPort}`,
			`Content-Length: ${contentLength}`,
			'Connection: close',
			//no compression
			'Accept-Encoding: identity',
			...buildHeaders(pubHeaders),
			...secHeadersList,
			'\r\n',
		].join('\r\n')
		const headerStr = strToUint8Array(httpReqHeaderStr)
		const data = concatenateUint8Arrays([headerStr, body])

		// hide all secret headers
		const secHeadersStr = secHeadersList.join('\r\n')
		const tokenStartIndex = findIndexInUint8Array(
			data,
			strToUint8Array(secHeadersStr)
		)
		if(tokenStartIndex < 0) {
			throw new Error('Failed to find secret headers list in request')
		}

		const authRedactions = [
			{
				fromIndex: tokenStartIndex,
				toIndex: tokenStartIndex + secHeadersStr.length,
			}
		]

		return {
			data,
			redactions: authRedactions,
		}
	},
	getResponseRedactions(response, paramsAny) {
		const res = parseHttpResponse(response)
		// if the response is not 2xx, then we don't need
		// to redact anything as the request itself failed
		if(((res.statusCode / 100) >> 0) !== 2) {
			console.log('===RESPONSE===')
			console.log(uint8ArrayToBinaryStr(res.body))
			throw new Error(`Provider returned error "${res.statusCode} ${res.statusMessage}"`)
		}

		const params = normaliseParamsToV2(paramsAny)
		if(!params.responseRedactions?.length) {
			return []
		}

		const headerEndIndex = res.statusLineEndIndex!
		const bodyStartIdx = res.bodyStartIndex!
		if(bodyStartIdx < 4) {
			throw new Error('Failed to find body')
		}

		const body = uint8ArrayToBinaryStr(res.body)
		const reveals: ArraySlice[] = [{ fromIndex: 0, toIndex: headerEndIndex }]
		for(const rs of params.responseRedactions) {
			let element = body
			let elementIdx = 0
			let elementLength = -1

			if(rs.xPath) {
				element = extractHTMLElement(body, rs.xPath, !!rs.jsonPath)
				const substr = findSubstringIgnoreLE(body, element)
				if(substr.index < 0) {
					throw new Error(`Failed to find element: "${rs.xPath}"`)
				}

				elementIdx = substr.index
				elementLength = substr.length
			}

			if(rs.jsonPath) {
				const { start, end } = extractJSONValueIndex(element, rs.jsonPath)
				// if there's only json path used
				if(elementIdx < 0) {
					elementIdx = 0
				}

				if(start < 0) {
					throw new Error('Failed to find element')
				}

				element = body.slice(elementIdx + start, elementIdx + end)
				elementIdx += start
				elementLength = end - start
			}

			if(rs.regex) {
				const regexp = makeRegex(rs.regex)
				const elem = element || body
				const match = regexp.exec(elem)
				if(!match) {
					throw new Error(
						`regexp ${rs.regex} does not match found element '${elem}'`
					)
				}

				elementIdx += match.index
				elementLength = regexp.lastIndex - match.index
				element = match[0]
			}

			if(elementIdx > 0 && elementLength > 0) {
				const from = convertResponsePosToAbsolutePos(
					elementIdx,
					bodyStartIdx,
					res.chunks
				)
				const to = convertResponsePosToAbsolutePos(
					elementIdx + elementLength,
					bodyStartIdx,
					res.chunks
				)
				reveals.push({ fromIndex: from, toIndex: to })
			}
		}

		reveals.sort((a, b) => {
			return a.toIndex - b.toIndex
		})

		const redactions: ArraySlice[] = []
		if(reveals.length > 1) {
			let currentIndex = 0
			for(const r of reveals) {
				if(currentIndex < r.fromIndex) {
					redactions.push({ fromIndex: currentIndex, toIndex: r.fromIndex })
				}

				currentIndex = r.toIndex
			}

			redactions.push({ fromIndex: currentIndex, toIndex: response.length })
		}

		return redactions
	},
	assertValidProviderReceipt(receipt, paramsAny) {
		const params = normaliseParamsToV2(paramsAny)
		const msgs = extractApplicationDataMsgsFromTranscript(receipt)
		const req = getHttpRequestHeadersFromTranscript(msgs)
		if(req.method !== params.method.toLowerCase()) {
			logTranscript()

			throw new Error(`Invalid method: ${req.method}`)
		}


		function logTranscript() {

			const clientMsgs = msgs.filter(s => s.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT).map(m => m.data)
			const serverMsgs = msgs.filter(s => s.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER).map(m => m.data)


			const clientTranscript = uint8ArrayToStr(concatenateUint8Arrays(clientMsgs))
			const serverTranscript = uint8ArrayToStr(concatenateUint8Arrays(serverMsgs))
			console.log('====REQUEST=====')
			console.log(clientTranscript)
			console.log('====RESPONSE====')
			console.log(serverTranscript)
		}

		const { hostname, pathname, port } = new URL(params.url)
		const searchParams = params.url.includes('?') ? params.url.split('?')[1] : ''
		const expectedPath = pathname + (searchParams?.length ? '?' + searchParams : '')
		if(req.url !== expectedPath) {
			console.log('params URL:', params.url)
			logTranscript()
			throw new Error(`Expected path: ${expectedPath}, found: ${req.url}`)
		}

		const expHostPort = `${hostname}:${port || DEFAULT_PORT}`
		if(receipt.hostPort !== expHostPort) {
			logTranscript()

			throw new Error(
				`Expected hostPort: ${expHostPort}, found: ${receipt.hostPort}`
			)
		}


		const serverBlocks = msgs.filter(s => s.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER)
			.map((r) => r.data)
			.filter(b => !b.every(b => b === REDACTION_CHAR_CODE)) // filter out fully redacted blocks
			.map(b => uint8ArrayToBinaryStr(b))

		const res = serverBlocks.join()

		if(!res.startsWith(OK_HTTP_HEADER)) {
			logTranscript()

			throw new Error(`Missing "${OK_HTTP_HEADER}" header in response`)
		}

		if(req.headers['connection'] !== 'close') {
			logTranscript()

			throw new Error('Connection header must be "close"')
		}

		for(const { type, value } of params.responseMatches) {
			switch (type) {
			case 'regex':
				if(!makeRegex(value).test(res)) {
					logTranscript()

					throw new Error(`Invalid receipt. Regex "${value}" failed to match`)
				}

				break
			case 'contains':
				if(!res.includes(value)) {
					logTranscript()

					const trimmedStr =
                            value.length > 100 ? value.slice(0, 100) + '...' : value
					throw new Error(
						`Invalid receipt. Response does not contain "${trimmedStr}"`
					)
				}

				break
			}
		}
	},
}

// From https://stackoverflow.com/a/3561711/157247
function escapeRegex(s: string) {
	return s.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')
}

function findSubstringIgnoreLE(str: string, substr: string): { index: number, length: number } {
	// Split up the text on any of the newline sequences,
	// then escape the parts in-between,
	// then join together with the alternation
	const rexText = substr
		.split(/\r\n|\n|\r/)
		.map((part) => escapeRegex(part))
		.join('(?:\\r\\n|\\n|\\r)')
	// Create the regex
	const re = new RegExp(rexText)
	// Run it
	const match = re.exec(str)
	if(match) {
		return {
			index: match.index,
			length: match[0].length
		}
	} else {
		return { index: -1, length: -1 }
	}
}


export default HTTP_PROVIDER
