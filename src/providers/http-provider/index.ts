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
            !params.headers
		) {
			throw new Error('auth parameters are not set')
		}

		const headers: string[] = []
		const authHeaderValues: string[] = []
		if(secretParams.cookieStr) {
			headers.push(`cookie: ${secretParams.cookieStr}`)
			authHeaderValues.push(secretParams.cookieStr)
		}

		if(secretParams.authorisationHeader) {
			headers.push(`Authorization: ${secretParams.authorisationHeader}`)
			authHeaderValues.push(secretParams.authorisationHeader)
		}

		let hasUserAgent = false

		if(params.headers) {
			headers.push(...buildHeaders(params.headers))
			hasUserAgent = Object.keys(params.headers).find(k => {
				return k.toLowerCase() === 'user-agent'
			}) !== undefined
		}

		if(!hasUserAgent) {
			headers.push('User-Agent: ' + RECLAIM_USER_AGENT) //only set user-agent if not set by provider
		}

		const hostPort =
            this.hostPort instanceof Function ? this.hostPort(params) : this.hostPort
		const { pathname, searchParams } = new URL(params.url)
		const body =
            params.body instanceof Uint8Array
            	? params.body
            	: strToUint8Array(params.body || '')
		const contentLength = body.length
		const httpReqHeaderStr = [
			`${params.method} ${pathname}${searchParams?.size ? '?' + searchParams : ''} HTTP/1.1`,
			`Host: ${hostPort}`,
			`Content-Length: ${contentLength}`,
			'Connection: close',
			//no compression
			'Accept-Encoding: identity',
			...headers,
			'\r\n',
		].join('\r\n')
		const data = concatenateUint8Arrays([
			strToUint8Array(httpReqHeaderStr),
			body,
		])
		const authRedactions = authHeaderValues.map((value) => {
			const authStrArr = strToUint8Array(value)
			// the string index will work here as long as
			// the string is ascii
			const tokenStartIndex = findIndexInUint8Array(data, authStrArr)
			return {
				fromIndex: tokenStartIndex,
				toIndex: tokenStartIndex + authStrArr.length,
			}
		})

		//also redact extra headers
		if(params.headers) {
			for(const key of Object.keys(params.headers)) {
				const value = params.headers[key]
				let headerValue: string
				if(typeof value === 'object') {
					if(!value.hidden) {
						continue
					}

					headerValue = value.value
				} else {
					headerValue = value
				}

				const header = strToUint8Array(`${key}: ${headerValue}`)
				const headerStartIndex = findIndexInUint8Array(data, header)
				authRedactions.push({
					fromIndex: headerStartIndex,
					toIndex: headerStartIndex + header.length,
				})
			}
		}

		return {
			data,
			redactions: authRedactions,
		}
	},
	getResponseRedactions(response, paramsAny) {
		const res = parseHttpResponse(response)
		if(((res.statusCode / 100) >> 0) !== 2) {
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
			let elementIdx = -1
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

				elementIdx = match.index
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
			throw new Error(`Invalid method: ${req.method}`)
		}

		const { hostname, pathname, port, searchParams } = new URL(params.url)
		const expectedPath = pathname + (searchParams?.size ? '?' + searchParams : '')
		if(req.url !== expectedPath) {
			throw new Error(`Expected path: ${expectedPath}, found: ${req.url}`)
		}

		const expHostPort = `${hostname}:${port || DEFAULT_PORT}`
		if(receipt.hostPort !== expHostPort) {
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
			throw new Error(`Missing "${OK_HTTP_HEADER}" header in response`)
		}

		if(req.headers['connection'] !== 'close') {
			throw new Error('Connection header must be "close"')
		}

		for(const { type, value } of params.responseMatches) {
			switch (type) {
			case 'regex':
				if(!makeRegex(value).test(res)) {
					throw new Error(`Invalid receipt. Regex "${value}" failed to match`)
				}

				break
			case 'contains':
				if(!res.includes(value)) {
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
