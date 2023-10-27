import { concatenateUint8Arrays, strToUint8Array } from '@reclaimprotocol/tls'
import { DEFAULT_PORT, RECLAIM_USER_AGENT } from '../../config'
import { TranscriptMessageSenderType } from '../../proto/api'
import { ArraySlice, Provider } from '../../types'
import { findIndexInUint8Array, getHttpRequestHeadersFromTranscript, uint8ArrayToBinaryStr, } from '../../utils'
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

const OK_HTTP_HEADER = 'HTTP/1.1 200 OK'

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
            Array.isArray(params.responseSelections) &&
            params.responseSelections.length > 0
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

		if(params.headers) {
			headers.push(...buildHeaders(params.headers))
			let hasUserAgent = false
			for(const [key] of Object.entries(params.headers)) {
				if(key.toLowerCase() === 'user-agent') {
					hasUserAgent = true
					break
				}
			}

			if(!hasUserAgent) {
				headers.push('User-Agent: ' + RECLAIM_USER_AGENT) //only set user-agent if not set by provider
			}
		}

		const hostPort =
            this.hostPort instanceof Function ? this.hostPort(params) : this.hostPort
		const { pathname } = new URL(params.url)
		const body =
            params.body instanceof Uint8Array
            	? params.body
            	: strToUint8Array(params.body || '')
		const contentLength = body.length
		const httpReqHeaderStr = [
			`${params.method} ${pathname} HTTP/1.1`,
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
				elementIdx = body.indexOf(element)
				if(elementIdx < 0) {
					throw new Error(`Failed to find element: "${rs.xPath}"`)
				}

				elementLength = element.length
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
		const req = getHttpRequestHeadersFromTranscript(receipt)
		if(req.method !== params.method.toLowerCase()) {
			throw new Error(`Invalid method: ${req.method}`)
		}

		const { hostname, pathname, port } = new URL(params.url)
		if(req.url !== pathname) {
			throw new Error(`Expected path: ${pathname}, found: ${req.url}`)
		}

		const expHostPort = `${hostname}:${port || DEFAULT_PORT}`
		if(receipt.hostPort !== expHostPort) {
			throw new Error(
				`Expected hostPort: ${expHostPort}, found: ${receipt.hostPort}`
			)
		}

		const res = Buffer.concat(
			receipt.transcript
				.filter(
					(r) => r.senderType ===
                        TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER &&
                        !r.redacted
				)
				.map((r) => r.message)
		).toString()

		if(!res.includes(OK_HTTP_HEADER)) {
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

export default HTTP_PROVIDER
