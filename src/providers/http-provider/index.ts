import { concatenateUint8Arrays, strToUint8Array, TLSConnectionOptions } from '@reclaimprotocol/tls'
import Ajv from 'ajv'
import { DEFAULT_HTTPS_PORT, RECLAIM_USER_AGENT } from '../../config'
import { ArraySlice, Provider } from '../../types'
import {
	findIndexInUint8Array,
	getHttpRequestDataFromTranscript, logger,
	REDACTION_CHAR_CODE,
	uint8ArrayToBinaryStr,
	uint8ArrayToStr,
} from '../../utils'
import { HTTPProviderParams, HTTPProviderParamsV2, HTTPProviderSecretParams, paramsV2Schema } from './types'
import {
	buildHeaders,
	convertResponsePosToAbsolutePos,
	extractHTMLElement,
	extractJSONValueIndex,
	makeRegex,
	matchRedactedStrings,
	normaliseParamsToV2,
	parseHttpResponse,
} from './utils'

export * from './types'

const OK_HTTP_HEADER = 'HTTP/1.1 200'
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false })
const validateParams = ajv.compile(paramsV2Schema)

const HTTP_PROVIDER: Provider<HTTPProviderParams, HTTPProviderSecretParams> = {
	hostPort: getHostPort,
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

	additionalClientOptions(params: HTTPProviderParams): TLSConnectionOptions {

		let defaultOptions: TLSConnectionOptions = {
			applicationLayerProtocols : ['http/1.1']
		}
		if('additionalClientOptions' in params) {
			defaultOptions = {
				...defaultOptions,
				...params.additionalClientOptions
			}
		}

		return defaultOptions
	},

	areValidParams(params): params is HTTPProviderParams {
		const valid = validateParams(params)
		if(!valid) {
			throw new Error(`params validation failed: ${JSON.stringify(validateParams.errors)}`)
		}

		return true
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

		const newParams = substituteParamValues(normaliseParamsToV2(params), secretParams)
		params = newParams.newParams

		const url = new URL(params.url)
		const { pathname } = url
		const searchParams = params.url.includes('?') ? params.url.split('?')[1] : ''
		logger.info({ url: params.url, path: pathname, query: searchParams.toString() })
		const body =
            params.body instanceof Uint8Array
            	? params.body
            	: strToUint8Array(params.body || '')
		const contentLength = body.length
		const reqLine = `${params.method} ${pathname}${searchParams?.length ? '?' + searchParams : ''} HTTP/1.1`
		const secHeadersList = buildHeaders(secHeaders)
		logger.info({ requestLine: reqLine })
		const httpReqHeaderStr = [
			reqLine,
			`Host: ${getHostHeaderString(url)}`,
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

		const redactions = [
			{
				fromIndex: tokenStartIndex,
				toIndex: tokenStartIndex + secHeadersStr.length,
			}
		]

		if(newParams.hiddenBodyParts?.length > 0) {
			for(const hiddenBodyPart of newParams.hiddenBodyParts) {
				if(hiddenBodyPart.length) {
					redactions.push({
						fromIndex: headerStr.length + hiddenBodyPart.index,
						toIndex: headerStr.length + hiddenBodyPart.index + hiddenBodyPart.length,
					})
				}
			}
		}

		return {
			data,
			redactions: redactions,
		}
	},
	getResponseRedactions(response, paramsAny) {
		const res = parseHttpResponse(response)
		const rawParams = normaliseParamsToV2(paramsAny)
		if(!rawParams.responseRedactions?.length) {
			return []
		}

		const newParams = substituteParamValues(rawParams, undefined, true)
		const params = newParams.newParams

		const headerEndIndex = res.statusLineEndIndex!
		const bodyStartIdx = res.bodyStartIndex ?? 0
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
					logger.error({ response: uint8ArrayToBinaryStr(res.body) })
					throw new Error(`Failed to find element: "${rs.xPath}"`)
				}

				elementIdx = substr.index
				elementLength = substr.length
				element = body.slice(elementIdx, elementIdx + elementLength)
			}

			if(rs.jsonPath) {
				const { start, end } = extractJSONValueIndex(element, rs.jsonPath)
				element = body.slice(elementIdx + start, elementIdx + end)
				elementIdx += start
				elementLength = end - start
			}

			if(rs.regex) {
				const regexp = makeRegex(rs.regex)
				const elem = element || body
				const match = regexp.exec(elem)
				if(!match?.[0]) {
					logger.error({ response: uint8ArrayToBinaryStr(res.body) })
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
		const newParams = substituteParamValues(normaliseParamsToV2(paramsAny), undefined, true)
		const params = newParams.newParams
		extractedParams = { ...extractedParams, ...newParams.extractedValues }

		const req = getHttpRequestDataFromTranscript(receipt)
		if(req.method !== params.method.toLowerCase()) {
			logTranscript()
			throw new Error(`Invalid method: ${req.method}`)
		}

		const url = new URL(params.url)
		const { protocol, pathname } = url

		if(protocol !== 'https:') {
			logger.error('params URL: %s', params.url)
			logTranscript()
			throw new Error(`Expected protocol: https, found: ${protocol}`)
		}

		const searchParams = params.url.includes('?') ? params.url.split('?')[1] : ''
		const expectedPath = pathname + (searchParams?.length ? '?' + searchParams : '')
		if(req.url !== expectedPath) {
			logger.error('params URL: %s', params.url)
			logTranscript()
			throw new Error(`Expected path: ${expectedPath}, found: ${req.url}`)
		}

		const expectedHostStr = getHostHeaderString(url)
		if(req.headers.host !== expectedHostStr) {
			logTranscript()
			throw new Error(`Expected host: ${expectedHostStr}, found: ${req.headers.host}`)
		}

		const serverBlocks = receipt
			.filter(s => s.sender === 'server')
			.map((r) => r.message)
			.filter(b => !b.every(b => b === REDACTION_CHAR_CODE)) // filter out fully redacted blocks
		const res = Buffer.from(concatArrays(...serverBlocks)).toString()
		if(!res.startsWith(OK_HTTP_HEADER)) {
			logTranscript()
			throw new Error(
				`Response did not start with "${OK_HTTP_HEADER}"`
			)
		}

		const connectionheader = req.headers['connection']
		if(connectionheader !== 'close') {
			logTranscript()
			throw new Error(`Connection header must be "close", got "${connectionheader}"`)
		}

		const paramBody = params.body instanceof Uint8Array
			? params.body
			: strToUint8Array(params.body || '')

		if(paramBody.length > 0) {
			if(!matchRedactedStrings(paramBody, req.body)) {
				logTranscript()
				throw new Error('request body mismatch')
			}
		}

		for(const { type, value, invert } of params.responseMatches) {
			const inv = Boolean(invert) // explicitly cast to boolean

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
					throw new Error(
						`Invalid receipt. Response ${invert ? 'contains' : 'does not contain'} "${value}"`
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

		return { extractedParameters: extractedParams }

		function logTranscript() {
			const clientMsgs = receipt.filter(s => s.sender === 'client').map(m => m.message)
			const serverMsgs = receipt.filter(s => s.sender === 'server').map(m => m.message)

			const clientTranscript = uint8ArrayToStr(concatenateUint8Arrays(clientMsgs))
			const serverTranscript = uint8ArrayToStr(concatenateUint8Arrays(serverMsgs))

			logger.error({ request: clientTranscript, response:serverTranscript, params:paramsAny })
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

function getHostPort(params: HTTPProviderParams) {
	const { host } = new URL(getURL(params))
	if(!host) {
		throw new Error('url is incorrect')
	}

	return host
}

/**
 * Obtain the host header string from the URL.
 * https://stackoverflow.com/a/3364396
 */
function getHostHeaderString(url: URL) {
	const host = url.hostname
	const port = url.port
	return port && +port !== DEFAULT_HTTPS_PORT
		? `${host}:${port}`
		: host

}

type ReplacedParams = {
    newParam: string
    extractedValues: { [_: string]: string }
    hiddenParts: { index: number, length: number } []
} | null

const paramsRegex = /\{\{([^{}]+)}}/sgi

function substituteParamValues(currentParams: HTTPProviderParamsV2, secretParams?: HTTPProviderSecretParams, ignoreMissingBodyParams?: boolean): {
    newParams: HTTPProviderParamsV2
    extractedValues: { [_: string]: string }
    hiddenBodyParts: { index: number, length: number } []
} {

	const params = JSON.parse(JSON.stringify(currentParams))
	let extractedValues: { [_: string]: string } = {}


	const urlParams = extractAndReplaceTemplateValues(params.url)
	if(urlParams) {
		params.url = urlParams.newParam
		extractedValues = { ...urlParams.extractedValues }
	}


	let bodyParams: ReplacedParams
	let hiddenBodyParts: { index: number, length: number } [] = []
	if(params.body) {
		const strBody = typeof params.body === 'string' ? params.body : uint8ArrayToStr(params.body)
		bodyParams = extractAndReplaceTemplateValues(strBody, ignoreMissingBodyParams)
		if(bodyParams) {
			params.body = bodyParams.newParam
			extractedValues = { ...extractedValues, ...bodyParams.extractedValues }
			hiddenBodyParts = bodyParams.hiddenParts
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
		extractedValues: extractedValues,
		hiddenBodyParts: hiddenBodyParts
	}

	function extractAndReplaceTemplateValues(param: string | undefined, ignoreMissingParams?: boolean): ReplacedParams {

		if(!param) {
			return null
		}

		//const paramNames: Set<string> = new Set()
		const extractedValues: { [_: string]: string } = {}
		const hiddenParts: { index: number, length: number }[] = []


		let totalOffset = 0
		param = param.replace(paramsRegex, (match, pn, offset) => {
			if(params.paramValues && pn in params.paramValues) {
				extractedValues[pn] = params.paramValues[pn]
				return params.paramValues[pn]
			} else if(secretParams) {
				if(secretParams?.paramValues && pn in secretParams?.paramValues) {
					hiddenParts.push({
						index: offset + totalOffset,
						length: secretParams.paramValues[pn].length,
					})
					totalOffset += secretParams.paramValues[pn].length - match.length
					return secretParams.paramValues[pn]
				} else {
					throw new Error(`parameter's "${pn}" value not found in paramValues and secret parameter's paramValues`)
				}
			} else {
				if(!(!!ignoreMissingParams)) {
					throw new Error(`parameter's "${pn}" value not found in paramValues`)
				} else {
					return match
				}
			}
		})

		return {
			newParam: param,
			extractedValues: extractedValues,
			hiddenParts: hiddenParts
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


export default HTTP_PROVIDER
