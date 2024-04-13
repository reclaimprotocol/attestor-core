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
import { HTTPProviderParams, HTTPProviderParamsV2, HTTPProviderSecretParams } from './types'
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
	additionalClientOptions: {
		applicationLayerProtocols: ['http/1.1'],
	},
	hostPort(params) {
		const { host } = new URL(getURL(params))
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
			? getGeoLocation(params)
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
			.some(k => k.toLowerCase() === 'user-agent') ||
            Object.keys(secHeaders)
            	.some(k => k.toLowerCase() === 'user-agent')
		if(!hasUserAgent) {
			//only set user-agent if not set by provider
			pubHeaders['User-Agent'] = RECLAIM_USER_AGENT
		}

		const newParams = substituteParamValues(<HTTPProviderParamsV2>params)
		params = newParams.newParams

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

		const rawParams = normaliseParamsToV2(paramsAny)
		if(!rawParams.responseRedactions?.length) {
			return []
		}

		const newParams = substituteParamValues(rawParams)
		const params = newParams.newParams

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
					console.log('===RESPONSE===')
					console.log(uint8ArrayToBinaryStr(res.body))
					throw new Error(`Failed to find element: "${rs.xPath}"`)
				}

				elementIdx = substr.index
				elementLength = substr.length
				element = body.slice(elementIdx, elementIdx + elementLength)
			}

			if(rs.jsonPath) {
				const { start, end } = extractJSONValueIndex(element, rs.jsonPath)
				// if there's only json path used
				if(elementIdx < 0) {
					elementIdx = 0
				}

				if(start < 0) {
					console.log('===RESPONSE===')
					console.log(uint8ArrayToBinaryStr(res.body))
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
					console.log('===RESPONSE===')
					console.log(uint8ArrayToBinaryStr(res.body))
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
		let extractedParams: { [_: string]: string } = {}

		const newParams = substituteParamValues(normaliseParamsToV2(paramsAny))
		const params = newParams.newParams
		extractedParams = { ...extractedParams, ...newParams.extractedValues }

		const msgs = extractApplicationDataMsgsFromTranscript(receipt)
		const req = getHttpRequestHeadersFromTranscript(msgs)
		if(req.method !== params.method.toLowerCase()) {
			logTranscript()
			throw new Error(`Invalid method: ${req.method}`)
		}

		const { protocol, hostname, pathname, port } = new URL(params.url)

		if(protocol !== 'https:') {
			console.log('params URL:', params.url)
			logTranscript()
			throw new Error(`Expected protocol: https, found: ${protocol}`)
		}

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

		if(req.headers.host !== hostname) {
			logTranscript()
			throw new Error(`Expected host: ${hostname}, found: ${req.headers.host}`)
		}

		const serverBlocks = msgs.filter(s => s.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER)
			.map((r) => r.data)
			.filter(b => !b.every(b => b === REDACTION_CHAR_CODE)) // filter out fully redacted blocks

		const res = Buffer.from(concatArrays(...serverBlocks)).toString()
		if(!res.startsWith(OK_HTTP_HEADER)) {
			logTranscript()
			throw new Error(`Missing "${OK_HTTP_HEADER}" header in response`)
		}

		if(req.headers['connection'] !== 'close') {
			logTranscript()
			throw new Error('Connection header must be "close"')
		}


		for(const { type, value, invert } of params.responseMatches) {

			const inv = !!invert // explicitly cast to boolean

			switch (type) {
			case 'regex':
				const regexRes = makeRegex(value).exec(res)
				const match = regexRes !== null
				if(match === inv) { // if both true or both false then fail
					logTranscript()
					throw new Error(`Invalid receipt. Regex "${value}" ${invert ? 'matched' : "didn't match"}`)
				}

				if(match) {
					const groups = regexRes?.groups
					if(groups) {
						for(const paramName in groups) {
							if(paramName in extractedParams) {
								throw new Error(`Duplicate parameter ${paramName}`)
							}

							extractedParams[paramName] = groups[paramName]
						}
					}
				}

				break
			case 'contains':
				const includes = res.includes(value)
				if(includes === inv) {
					logTranscript()

					const trimmedStr =
                            value.length > 100 ? value.slice(0, 100) + '...' : value
					throw new Error(
						`Invalid receipt. Response ${invert ? 'contains' : 'does not contain'} "${trimmedStr}"`
					)
				}

				break
			default:
				throw new Error(`Invalid response match type ${type}`)
			}
		}

		function concatArrays(...bufs: Uint8Array[]) {
			const totalSize = bufs.reduce((acc, e) => acc + e.length, 0)
			const merged = new Uint8Array(totalSize)

			bufs.forEach((array, i, arrays) => {
				const offset = arrays.slice(0, i).reduce((acc, e) => acc + e.length, 0)
				merged.set(array, offset)
			})

			return merged

		}

		return { extractedParams: extractedParams }

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
	},
}

export function findSubstringIgnoreLE(str: string, substr: string): { index: number, length: number } {
	// Split up the text on any of the newline sequences,
	// then escape the parts in-between,
	// then join together with the alternation
	const rexText = substr
		.split(/\r\n|\n|\r/)

	const newLines = ['\r\n', '\n', '\r']

	//try every type of newline
	for(const nl of newLines) {
		const sub = rexText.join(nl)
		const pos = str.indexOf(sub)
		if(pos !== -1) {
			return { index: pos, length: sub.length }
		}
	}

	return { index: -1, length: -1 }
}


type ReplacedParams = {
    newParam: string
    extractedValues: { [_: string]: string }
} | null

const paramsRegex = /\{\{([^{}]+)}}/sgi

function substituteParamValues(currentParams: HTTPProviderParamsV2): {
    newParams: HTTPProviderParamsV2
    extractedValues: { [_: string]: string }
} {

	const params = JSON.parse(JSON.stringify(currentParams))
	let extractedValues: { [_: string]: string } = {}


	const urlParams = extractAndReplaceTemplateValues(params.url)
	if(urlParams) {
		params.url = urlParams.newParam
		extractedValues = { ...urlParams.extractedValues }
	}


	let bodyParams: ReplacedParams
	if(params.body) {
		const strBody = typeof params.body === 'string' ? params.body : uint8ArrayToStr(params.body)
		bodyParams = extractAndReplaceTemplateValues(strBody)
		if(bodyParams) {
			params.body = bodyParams.newParam
			extractedValues = { ...extractedValues, ...bodyParams.extractedValues }
		}

	}

	const geoParams = extractAndReplaceTemplateValues(params.geoLocation)
	if(geoParams) {
		params.geoLocation = geoParams.newParam
		extractedValues = { ...extractedValues, ...geoParams.extractedValues }
	}

	if(params.responseRedactions) {
		params.responseRedactions.forEach(r => {
			if(r.regex) {
				const regexParams = extractAndReplaceTemplateValues(r.regex)
				r.regex = regexParams?.newParam
			}

			if(r.xPath) {
				const xpathParams = extractAndReplaceTemplateValues(r.xPath)
				r.xPath = xpathParams?.newParam
			}

			if(r.jsonPath) {
				const jsonPathParams = extractAndReplaceTemplateValues(r.jsonPath)
				r.jsonPath = jsonPathParams?.newParam
			}
		})
	}

	if(params.responseMatches) {
		params.responseMatches.forEach(r => {
			if(r.value !== '') {
				const matchParam = extractAndReplaceTemplateValues(r.value)
				r.value = matchParam?.newParam!
				extractedValues = { ...extractedValues, ...matchParam?.extractedValues }
			}
		})
	}

	return {
		newParams: params,
		extractedValues: extractedValues
	}

	function extractAndReplaceTemplateValues(param: string | undefined): ReplacedParams {

		if(!param) {
			return null
		}

		const paramNames: Set<string> = new Set()
		//extract param names

		let match: RegExpExecArray | null = null
		while(match = paramsRegex.exec(param)) {
			paramNames.add(match[1])
		}

		const extractedValues: { [_: string]: string } = {}
		paramNames.forEach(pn => {
			if(params.paramValues && pn in params.paramValues) {
				param = param?.replaceAll(`{{${pn}}}`, params.paramValues[pn])
				extractedValues[pn] = params.paramValues[pn]
			} else {
				throw new Error(`parameter "${pn}" value not found in templateParams`)
			}
		})

		return {
			newParam: param,
			extractedValues: extractedValues
		}
	}
}

function getGeoLocation(params: HTTPProviderParams) {
	if((params as HTTPProviderParamsV2)?.geoLocation) {
		const v2Params = params as HTTPProviderParamsV2
		let geo = v2Params?.geoLocation!
		const paramNames: Set<string> = new Set()
		//extract param names

		let match: RegExpExecArray | null = null
		while(match = paramsRegex.exec(geo)) {
			paramNames.add(match[1])
		}

		paramNames.forEach(pn => {
			if(v2Params.paramValues && pn in v2Params.paramValues) {
				geo = geo?.replaceAll(`{{${pn}}}`, v2Params.paramValues[pn].toString())
			} else {
				throw new Error(`parameter "${pn}" value not found in templateParams`)
			}
		})
		return geo
	}

	return undefined
}

function getURL(params: HTTPProviderParams) {
	if((params as HTTPProviderParamsV2)?.url) {
		const v2Params = params as HTTPProviderParamsV2
		let hostPort = v2Params?.url
		const paramNames: Set<string> = new Set()
		//extract param names

		let match: RegExpExecArray | null = null
		while(match = paramsRegex.exec(hostPort)) {
			paramNames.add(match[1])
		}

		paramNames.forEach(pn => {
			if(v2Params.paramValues && pn in v2Params.paramValues) {
				hostPort = hostPort?.replaceAll(`{{${pn}}}`, v2Params.paramValues[pn].toString())
			} else {
				throw new Error(`parameter "${pn}" value not found in templateParams`)
			}
		})
		return hostPort
	}

	return params.url
}

export default HTTP_PROVIDER
