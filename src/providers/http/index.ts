import type { TLSConnectionOptions } from '@reclaimprotocol/tls'
import { areUint8ArraysEqual, concatenateUint8Arrays, strToUint8Array } from '@reclaimprotocol/tls'
import { utils } from 'ethers'
import { DEFAULT_HTTPS_PORT, RECLAIM_USER_AGENT } from 'src/config/index.ts'
import { AttestorVersion } from 'src/proto/api.ts'
import {
	buildHeaders,
	convertResponsePosToAbsolutePos,
	extractHTMLElementsIndexes,
	extractJSONValueIndexes, getRedactionsForChunkHeaders,
	makeRegex,
	matchRedactedStrings,
	parseHttpResponse,
} from 'src/providers/http/utils.ts'
import type { ArraySlice, Provider, ProviderCtx, ProviderParams, ProviderSecretParams, RedactedOrHashedArraySlice } from 'src/types/index.ts'
import {
	findIndexInUint8Array,
	getHttpRequestDataFromTranscript, logger,
	REDACTION_CHAR_CODE,
	uint8ArrayToBinaryStr,
	uint8ArrayToStr,
} from 'src/utils/index.ts'

const { base64 } = utils

const OK_HTTP_HEADER = 'HTTP/1.1 200'
const dateHeaderRegex = '[dD]ate: ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:[0-3][0-9]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:[0-9]{4}) (?:[01][0-9]|2[0-3])(?::[0-5][0-9]){2} GMT)'
const dateDiff = 1000 * 60 * 10 // allow 10 min difference

type HTTPProviderParams = ProviderParams<'http'>

type HTTPResponseRedaction = Exclude<HTTPProviderParams['responseRedactions'], undefined>[number]

const HTTP_PROVIDER: Provider<'http'> = {
	hostPort: getHostPort,
	writeRedactionMode(params) {
		return ('writeRedactionMode' in params)
			? params.writeRedactionMode
			: undefined
	},
	geoLocation(params, secretParams) {
		return ('geoLocation' in params)
			? getGeoLocation(params, secretParams)
			: undefined
	},
	additionalClientOptions(params): TLSConnectionOptions {
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
	createRequest(secretParams, params, logger) {
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

		const newParams = substituteParamValues(params, secretParams)
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

		if(newParams.hiddenURLParts?.length > 0) {
			for(const hiddenURLPart of newParams.hiddenURLParts) {
				if(hiddenURLPart.length) {
					redactions.push({
						fromIndex: hiddenURLPart.index,
						toIndex: hiddenURLPart.index + hiddenURLPart.length,
					})
				}
			}
		}

		redactions.sort((a, b) => a.toIndex - b.toIndex)
		return {
			data,
			redactions: redactions,
		}
	},
	getResponseRedactions({ response, params: rawParams, logger, ctx }) {
		logger.debug({ response:base64.encode(response), params:rawParams })

		const res = parseHttpResponse(response)
		if(!rawParams.responseRedactions?.length) {
			return []
		}

		if(((res.statusCode / 100) >> 0) !== 2) {
			logger.error({ response:base64.encode(response), params:rawParams })
			throw new Error(
				`Expected status 2xx, got ${res.statusCode} (${res.statusMessage})`
			)
		}

		const newParams = substituteParamValues(rawParams, undefined, true)
		const params = newParams.newParams

		const headerEndIndex = res.statusLineEndIndex!
		const bodyStartIdx = res.bodyStartIndex ?? 0
		if(bodyStartIdx < 4) {
			logger.error({ response: uint8ArrayToBinaryStr(response) })
			throw new Error('Failed to find response body')
		}

		const reveals: RedactedOrHashedArraySlice[] = [
			{ fromIndex: 0, toIndex: headerEndIndex }
		]

		//reveal double CRLF which separates headers from body
		if(shouldRevealCrlf(ctx)) {
			const crlfs = response
				.slice(res.headerEndIdx, res.headerEndIdx + 4)
			if(!areUint8ArraysEqual(crlfs, strToUint8Array('\r\n\r\n'))) {
				logger.error({ response: uint8ArrayToBinaryStr(response) })
				throw new Error(
					`Failed to find header/body separator at index ${res.headerEndIdx}`
				)
			}
		}

		reveals.push({ fromIndex:res.headerEndIdx, toIndex:res.headerEndIdx + 4 })

		//reveal date header
		if(res.headerIndices['date']) {
			reveals.push(res.headerIndices['date'])
		}

		const body = uint8ArrayToBinaryStr(res.body)
		const redactions: RedactedOrHashedArraySlice[] = []
		for(const rs of params.responseRedactions || []) {
			const processor = processRedactionRequest(
				body, rs, bodyStartIdx, res.chunks
			)
			for(const { reveal, redactions: reds } of processor) {
				reveals.push(reveal)
				redactions.push(...reds)
			}
		}

		reveals.sort((a, b) => a.toIndex - b.toIndex)

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

		for(const r of reveals) {
			if(!r.hash) {
				continue
			}

			redactions.push(r)
		}

		redactions.sort((a, b) => a.toIndex - b.toIndex)

		return redactions
	},
	assertValidProviderReceipt({ receipt, params: paramsAny, logger, ctx }) {
		logTranscript()
		let extractedParams: { [_: string]: string } = {}
		const secretParams = ('secretParams' in paramsAny)
			? paramsAny.secretParams as ProviderSecretParams<'http'>
			: undefined
		const newParams = substituteParamValues(paramsAny, secretParams, !secretParams)
		const params = newParams.newParams
		extractedParams = { ...extractedParams, ...newParams.extractedValues }

		const req = getHttpRequestDataFromTranscript(receipt)
		if(req.method !== params.method.toLowerCase()) {
			throw new Error(`Invalid method: ${req.method}`)
		}

		const url = new URL(params.url)
		const { protocol, pathname } = url

		if(protocol !== 'https:') {
			logger.error('params URL: %s', params.url)
			throw new Error(`Expected protocol: https, found: ${protocol}`)
		}

		const searchParams = params.url.includes('?') ? params.url.split('?')[1] : ''
		//brackets in URL path turn into %7B and %7D, so replace them back
		const expectedPath = pathname.replaceAll('%7B', '{').replaceAll('%7D', '}') + (searchParams?.length ? '?' + searchParams : '')
		if(!matchRedactedStrings(strToUint8Array(expectedPath), strToUint8Array(req.url))) {
			logger.error('params URL: %s', params.url)
			throw new Error(`Expected path: ${expectedPath}, found: ${req.url}`)
		}

		const expectedHostStr = getHostHeaderString(url)
		if(req.headers.host !== expectedHostStr) {
			throw new Error(`Expected host: ${expectedHostStr}, found: ${req.headers.host}`)
		}

		const connectionHeader = req.headers['connection']
		if(connectionHeader !== 'close') {
			throw new Error(`Connection header must be "close", got "${connectionHeader}"`)
		}

		const serverBlocks = receipt
			.filter(s => s.sender === 'server')
			.map((r) => r.message)
			.filter(b => !b.every(b => b === REDACTION_CHAR_CODE)) // filter out fully redacted blocks
		const response = concatArrays(...serverBlocks)

		let res: string
		res = uint8ArrayToStr(response)

		const okRegex = makeRegex('^HTTP\\/1.1 2\\d{2}')
		const matchRes = okRegex.exec(res)
		if(!matchRes) {
			const statusRegex = makeRegex('^HTTP\\/1.1 (\\d{3})')
			const matchRes = statusRegex.exec(res)
			if(matchRes && matchRes.length > 1) {
				throw new Error(
					`Provider returned error ${matchRes[1]}"`
				)
			}

			let lineEnd = res.indexOf('*')
			if(lineEnd === -1) {
				lineEnd = res.indexOf('\n')
			}

			if(lineEnd === -1) {
				lineEnd = OK_HTTP_HEADER.length
			}

			throw new Error(
				`Response did not start with \"HTTP/1.1 2XX\" got "${res.slice(0, lineEnd)}"`
			)
		}

		let bodyStart: number
		if(shouldRevealCrlf(ctx)) {
			bodyStart = res.indexOf('\r\n\r\n', OK_HTTP_HEADER.length) + 4
			if(bodyStart < 4) {
				throw new Error('Response body start not found')
			}
		} else {
			bodyStart = OK_HTTP_HEADER.length
		}

		//validate server Date header if present
		const dateHeader = makeRegex(dateHeaderRegex).exec(res)
		if(dateHeader?.length > 1) {
			const serverDate = new Date(dateHeader[1])
			if((Date.now() - serverDate.getTime()) > dateDiff) {

				logger.info({ dateHeader:dateHeader[0], current: Date.now() }, 'date header is off')

				// too many false positives
				// throw new Error(
				// 	`Server date is off by "${(Date.now() - serverDate.getTime()) / 1000} s"`
				// )
			}
		}


		const paramBody = params.body instanceof Uint8Array
			? params.body
			: strToUint8Array(params.body || '')

		if(paramBody.length > 0 && !matchRedactedStrings(paramBody, req.body)) {
			throw new Error('request body mismatch')
		}


		//remove asterisks to account for chunks in the middle of revealed strings
		if(!secretParams) {
			res = res.slice(bodyStart).replace(/(\*){3,}/g, '')
		}


		for(const { type, value, invert } of params.responseMatches || []) {
			const inv = Boolean(invert) // explicitly cast to boolean

			switch (type) {
			case 'regex':
				const regexRes = makeRegex(value).exec(res)
				const match = regexRes !== null
				if(match === inv) { // if both true or both false then fail
					throw new Error(
						'Invalid receipt.'
						+ ` Regex "${value}" ${invert ? 'matched' : "didn't match"}`
					)
				}

				if(!match) {
					continue
				}

				const groups = regexRes?.groups
				for(const paramName in groups || []) {
					if(paramName in extractedParams) {
						throw new Error(`Duplicate parameter ${paramName}`)
					}

					extractedParams[paramName] = groups[paramName]
				}

				break
			case 'contains':
				const includes = res.includes(value)
				if(includes === inv) {
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

			let lenDone = 0
			for(const array of bufs) {
				merged.set(array, lenDone)
				lenDone += array.length
			}

			return merged

		}

		return { extractedParameters: extractedParams }

		function logTranscript() {
			const clientMsgs = receipt.filter(s => s.sender === 'client').map(m => m.message)
			const serverMsgs = receipt.filter(s => s.sender === 'server').map(m => m.message)

			const clientTranscript = base64.encode(concatenateUint8Arrays(clientMsgs))
			const serverTranscript = base64.encode(concatenateUint8Arrays(serverMsgs))

			logger.debug({ request: clientTranscript, response:serverTranscript, params:paramsAny })
		}
	},
}

// revealing CRLF is a breaking change -- and should only be done
// if the client's version supports it
function shouldRevealCrlf({ version }: ProviderCtx) {
	return version >= AttestorVersion.ATTESTOR_VERSION_2_0_1
}

function getHostPort(params: ProviderParams<'http'>, secretParams: ProviderSecretParams<'http'>) {
	const { host } = new URL(getURL(params, secretParams))
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

type RedactionItem = {
	reveal: RedactedOrHashedArraySlice
	redactions: RedactedOrHashedArraySlice[]
}

const paramsRegex = /{{([^{}]+)}}/sgi

function *processRedactionRequest(
	body: string,
	rs: HTTPResponseRedaction,
	bodyStartIdx: number,
	resChunks: ArraySlice[] | undefined,
): Generator<RedactionItem> {
	let element = body
	let elementIdx = 0
	let elementLength = -1

	if(rs.xPath) {
		const indexes = extractHTMLElementsIndexes(body, rs.xPath, !!rs.jsonPath)
		for(const { start, end } of indexes) {
			element = body.slice(start, end)
			elementIdx = start
			elementLength = end - start
			if(rs.jsonPath) {
				yield *processJsonPath()
			} else if(rs.regex) {
				yield *processRegexp()
			} else {
				yield *addRedaction()
			}
		}
	} else if(rs.jsonPath) {
		yield *processJsonPath()
	} else if(rs.regex) {
		yield *processRegexp()
	} else {
		throw new Error(
			'Expected either xPath, jsonPath or regex for redaction'
		)
	}

	function *processJsonPath() {
		const jsonPathIndexes = extractJSONValueIndexes(element, rs.jsonPath!)
		// eslint-disable-next-line max-depth
		const eIndex = elementIdx
		for(const ji of jsonPathIndexes) {
			const jStart = ji.start
			const jEnd = ji.end
			element = body.slice(eIndex + jStart, eIndex + jEnd)
			elementIdx = eIndex + jStart
			elementLength = jEnd - jStart
			// eslint-disable-next-line max-depth
			if(rs.regex) {
				yield *processRegexp()
			} else {
				yield *addRedaction()
			}
		}
	}

	function *processRegexp() {
		logger.debug({ element: base64.encode(strToUint8Array(element)), body: base64.encode(strToUint8Array(body)) })
		const regexp = makeRegex(rs.regex!)
		const elem = element || body
		const match = regexp.exec(elem)
		// eslint-disable-next-line max-depth
		if(!match?.[0]) {

			throw new Error(
				`regexp ${rs.regex} does not match found element '${base64.encode(strToUint8Array(elem))}'`
			)
		}

		elementIdx += match.index
		elementLength = regexp.lastIndex - match.index
		element = match[0]

		if(rs.hash && (!match.groups || Object.keys(match.groups).length > 1)) {
			throw new Error(
				'Exactly one named capture group is needed per hashed redaction'
			)
		}

		// if there are groups in the regex,
		// we'll only hash the group values
		if(!rs.hash || !match.groups) {
			yield *addRedaction()
			return
		}


		const fullStr = match[0]
		const grp = Object.values(match.groups)[0] as string
		const grpIdx = fullStr.indexOf(grp)

		// don't hash the entire regex, we'll hash the group values
		elementLength = grpIdx
		element = fullStr.slice(0, grpIdx)
		yield *addRedaction(null)

		elementIdx += grpIdx
		element = grp
		elementLength = grp.length

		const reveal = getReveal(elementIdx, elementLength, rs.hash)
		const chunkReds = getRedactionsForChunkHeaders(
			reveal.fromIndex,
			reveal.toIndex,
			resChunks
		)
		if(chunkReds.length) {
			throw new Error(
				'Hash redactions cannot be performed if '
				+ 'the redacted string is split between 2'
				+ ' or more HTTP chunks'
			)
		}

		yield { reveal, redactions: chunkReds }

		elementIdx += grp.length
		element = fullStr.slice(grpIdx + grp.length)
		elementLength = element.length
		yield *addRedaction(null)
	}

	// eslint-disable-next-line unicorn/consistent-function-scoping
	function *addRedaction(
		hash: RedactedOrHashedArraySlice['hash'] | null = rs.hash,
		_resChunks = resChunks
	): Generator<RedactionItem> {
		if(elementIdx < 0 || !elementLength) {
			return
		}

		const reveal = getReveal(elementIdx, elementLength, hash || undefined)

		yield {
			reveal,
			redactions: getRedactionsForChunkHeaders(
				reveal.fromIndex,
				reveal.toIndex,
				_resChunks
			)
		}
	}

	function getReveal(
		startIdx: number,
		len: number,
		hash?: RedactedOrHashedArraySlice['hash']
	) {
		const from = convertResponsePosToAbsolutePos(
			startIdx,
			bodyStartIdx,
			resChunks
		)
		const to = convertResponsePosToAbsolutePos(
			startIdx + len,
			bodyStartIdx,
			resChunks
		)

		return { fromIndex: from, toIndex: to, hash }
	}
}

function substituteParamValues(
	currentParams: HTTPProviderParams,
	secretParams?: ProviderSecretParams<'http'>,
	ignoreMissingParams?: boolean
): {
    newParams: HTTPProviderParams
    extractedValues: { [_: string]: string }
    hiddenBodyParts: { index: number, length: number } []
	hiddenURLParts: { index: number, length: number } []
} {

	const params = JSON.parse(JSON.stringify(currentParams))
	let extractedValues: { [_: string]: string } = {}

	const hiddenURLParts: { index: number, length: number } [] = []
	const urlParams = extractAndReplaceTemplateValues(params.url, ignoreMissingParams)
	if(urlParams) {
		params.url = urlParams.newParam
		extractedValues = { ...urlParams.extractedValues }

		if(urlParams.hiddenParts.length) {
			const host = getHostHeaderString(new URL(params.url))
			const offset = `https://${host}`.length - currentParams.method.length - 1 //space between method and start of the path
			for(const hiddenURLPart of urlParams.hiddenParts) {
				hiddenURLParts.push({ index:hiddenURLPart.index - offset, length:hiddenURLPart.length })
			}
		}

	}


	let bodyParams: ReplacedParams
	let hiddenBodyParts: { index: number, length: number } [] = []
	if(params.body) {
		const strBody = typeof params.body === 'string' ? params.body : uint8ArrayToStr(params.body)
		bodyParams = extractAndReplaceTemplateValues(strBody, ignoreMissingParams)
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
		for(const r of params.responseRedactions) {
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
		}
	}

	if(params.responseMatches) {
		for(const r of params.responseMatches) {
			if(r.value !== '') {
				const matchParam = extractAndReplaceTemplateValues(r.value)
				r.value = matchParam?.newParam!
				extractedValues = { ...extractedValues, ...matchParam?.extractedValues }
			}
		}
	}

	return {
		newParams: params,
		extractedValues: extractedValues,
		hiddenBodyParts: hiddenBodyParts,
		hiddenURLParts:hiddenURLParts
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
				totalOffset += params.paramValues[pn].length - match.length
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

function getGeoLocation(v2Params: HTTPProviderParams, secretParams?: ProviderSecretParams<'http'>) {
	if(v2Params?.geoLocation) {
		const paramNames: Set<string> = new Set()
		let geo = v2Params.geoLocation
		//extract param names

		let match: RegExpExecArray | null = null
		while(match = paramsRegex.exec(geo)) {
			paramNames.add(match[1])
		}

		for(const pn of paramNames) {
			if(v2Params.paramValues && pn in v2Params.paramValues) {
				geo = geo?.replaceAll(`{{${pn}}}`, v2Params.paramValues[pn].toString())
			} else if(secretParams?.paramValues && pn in secretParams.paramValues) {
				geo = geo?.replaceAll(`{{${pn}}}`, secretParams.paramValues[pn].toString())
			} else {
				throw new Error(`parameter "${pn}" value not found in templateParams`)
			}
		}

		const geoRegex = /^[A-Za-z]{2}$/sgiu
		if(!geoRegex.test(geo)) {
			throw new Error(`Geolocation ${geo} is invalid`)
		}

		return geo
	}

	return undefined
}

function getURL(v2Params: HTTPProviderParams, secretParams: ProviderSecretParams<'http'>) {
	let hostPort = v2Params?.url
	const paramNames: Set<string> = new Set()

	//extract param names
	let match: RegExpExecArray | null = null
	while(match = paramsRegex.exec(hostPort)) {
		paramNames.add(match[1])
	}

	for(const pn of paramNames) {
		if(v2Params.paramValues && pn in v2Params.paramValues) {
			hostPort = hostPort?.replaceAll(`{{${pn}}}`, v2Params.paramValues[pn].toString())
		} else if(secretParams?.paramValues && pn in secretParams.paramValues) {
			hostPort = hostPort?.replaceAll(`{{${pn}}}`, secretParams.paramValues[pn].toString())
		} else {
			throw new Error(`parameter "${pn}" value not found in templateParams`)
		}
	}

	return hostPort
}


export default HTTP_PROVIDER
