import { concatenateUint8Arrays, strToUint8Array, TLSConnectionOptions } from '@reclaimprotocol/tls'
import { base64 } from 'ethers/lib/utils'
import { DEFAULT_HTTPS_PORT, RECLAIM_USER_AGENT } from 'src/config'
import {
	buildHeaders, parseHttpResponse,
} from 'src/providers/http/utils'
import { Provider, ProviderParams } from 'src/types'
import {
	findIndexInUint8Array,
	getHttpRequestDataFromTranscript, logger,
	REDACTION_CHAR_CODE,
	uint8ArrayToBinaryStr,
} from 'src/utils'

type HTTPProviderParams = ProviderParams<'httpb64'>

const HTTP_BASE64_PROVIDER: Provider<'httpb64'> = {
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

		return {
			data,
			redactions: redactions,
		}
	},
	getResponseRedactions() {
		return []
	},
	assertValidProviderReceipt(receipt, params) {
		const extractedParams: { [_: string]: string } = {}

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
		const expectedPath = pathname + (searchParams?.length ? '?' + searchParams : '')
		if(req.url !== expectedPath) {
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

		const res = parseHttpResponse(response)


		if(((res.statusCode / 100) >> 0) !== 2) {
			throw new Error(`Provider returned ${res.statusCode} ${res.statusMessage} error`)
		}


		const bodyStartIdx = res.bodyStartIndex ?? 0
		if(bodyStartIdx < 4) {
			logger.error({ response: uint8ArrayToBinaryStr(response) })
			throw new Error('Failed to find response body')
		}

		extractedParams['data'] = base64.encode(res.body)

		return { extractedParameters: extractedParams }


	},
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

function getHostPort(params: ProviderParams<'http'>) {
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


const paramsRegex = /\{\{([^{}]+)}}/sgi

function getGeoLocation(v2Params: HTTPProviderParams) {
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
				geo = geo.replaceAll(`{{${pn}}}`, v2Params.paramValues[pn].toString())
			} else {
				throw new Error(`parameter "${pn}" value not found in templateParams`)
			}
		}

		return geo
	}

	return undefined
}

function getURL(v2Params: HTTPProviderParams) {
	let hostPort = v2Params?.url
	const paramNames: Set<string> = new Set()

	//extract param names
	let match: RegExpExecArray | null = null
	while(match = paramsRegex.exec(hostPort)) {
		paramNames.add(match[1])
	}

	for(const pn of paramNames) {
		if(v2Params.paramValues && pn in v2Params.paramValues) {
			hostPort = hostPort.replaceAll(`{{${pn}}}`, v2Params.paramValues[pn].toString())
		} else {
			throw new Error(`parameter "${pn}" value not found in templateParams`)
		}
	}

	return hostPort
}


export default HTTP_BASE64_PROVIDER
