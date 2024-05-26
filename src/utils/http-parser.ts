import { concatenateUint8Arrays, CONTENT_TYPE_MAP, PACKET_TYPE, strToUint8Array } from '@reclaimprotocol/tls'
import type { IncomingHttpHeaders } from 'http'
import { TLSReceipt, TLSVersion, TranscriptMessageSenderType } from '../proto/api'
import { ArraySlice, Transcript } from '../types'
import { findIndexInUint8Array, uint8ArrayToStr } from './generics'
import { REDACTION_CHAR_CODE } from './redactions'

type HttpRequest = {
    method: string
    url: string
    protocol: string
    headers: IncomingHttpHeaders
    body?: Uint8Array
}

type HttpResponse = {
    statusCode: number
    statusMessage: string
    headers: IncomingHttpHeaders
    body: Uint8Array
    headersComplete: boolean
    complete: boolean

    /**
     * Index of the first byte of the status line
     */
    statusLineEndIndex?: number
    /**
     * Index of the first byte of the body
     * in the complete response
     */
    bodyStartIndex?: number
    /**
     * If using chunked transfer encoding,
     * this will be set & contain indices of each
     * chunk in the complete response
     */
    chunks?: ArraySlice[]
}

type ApplicationMessage = {
    data: Uint8Array
    sender: TranscriptMessageSenderType
}

const DEFAULT_REDACTION_DATA = new Uint8Array(4)
	.fill(REDACTION_CHAR_CODE)
const HTTP_HEADER_LINE_END = strToUint8Array('\r\n')

/**
 * parses http/1.1 responses
 */
export function makeHttpResponseParser() {
	/** the HTTP response data */
	const res: HttpResponse = {
		statusCode: 0,
		statusMessage: '',
		headers: {},
		body: new Uint8Array(),
		complete: false,
		headersComplete: false,
	}

	let remainingBodyBytes = 0
	let isChunked = false
	let remaining = new Uint8Array()
	let currentByteIdx = 0

	return {
		res,
		/**
         * Parse the next chunk of data
         * @param data the data to parse
         */
		onChunk(data: Uint8Array) {
			// concatenate the remaining data from the last chunk
			remaining = concatenateUint8Arrays([remaining, data])
			// if we don't have the headers yet, keep reading lines
			// as each header is in a line
			if(!res.headersComplete) {
				for(let line = getLine(); typeof line !== 'undefined'; line = getLine()) {
					// first line is the HTTP version, status code & message
					if(!res.statusCode) {
						const [, statusCode, statusMessage] = line.match(/HTTP\/\d\.\d (\d+) (.*)/) || []
						res.statusCode = Number(statusCode)
						res.statusMessage = statusMessage
						res.statusLineEndIndex = currentByteIdx - HTTP_HEADER_LINE_END.length
					} else if(line === '') { // empty line signifies end of headers
						res.headersComplete = true
						// if the response is chunked, we need to process the body differently
						if(res.headers['transfer-encoding']?.includes('chunked')) {
							isChunked = true
							res.chunks = []
							break
							// if the response has a content-length, we know how many bytes to read
						} else if(res.headers['content-length']) {
							remainingBodyBytes = Number(res.headers['content-length'])
							break
						} else {
							remainingBodyBytes = -1
							// otherwise,
							// no content-length, no chunked transfer encoding
							// means wait till the stream ends
							// https://stackoverflow.com/a/11376887
						}
					} else if(!res.complete) { // parse the header
						const [key, value] = line.split(': ')
						res.headers[key.toLowerCase()] = value
					} else {
						throw new Error('got more data after response was complete')
					}
				}
			}

			if(res.headersComplete) {
				if(remainingBodyBytes) {
					readBody()
					// if no more body bytes to read,
					// and the response was not chunked we're done
					if(!remainingBodyBytes && !isChunked) {
						res.complete = true
					}
				}

				if(isChunked) {
					for(let line = getLine(); typeof line !== 'undefined'; line = getLine()) {
						if(line === '') {
							continue
						}

						const chunkSize = Number.parseInt(line, 16)
						// if chunk size is 0, we're done
						if(!chunkSize) {
							res.complete = true
							continue
						}

						res.chunks?.push({
							fromIndex: currentByteIdx,
							toIndex: currentByteIdx + chunkSize,
						})

						// otherwise read the chunk
						remainingBodyBytes = chunkSize
						readBody()

						// if we read all the data we had,
						// but there's still data left,
						// break the loop and wait for the next chunk
						if(remainingBodyBytes) {
							break
						}
					}
				}
			}
		},
		/**
         * Call to prevent further parsing; indicating the end of the request
         * Checks that the response is valid & complete, otherwise throws an error
         */
		streamEnded() {
			if(!res.headersComplete) {
				throw new Error('stream ended before headers were complete')
			}

			if(remaining.length) {
				throw new Error('stream ended with remaining data')
			}

			if(remainingBodyBytes > 0) {
				throw new Error('stream ended before all body bytes were received')
			}

			res.complete = true
		}
	}

	function readBody() {
		if(res.complete) {
			throw new Error('got more data after response was complete')
		}

		if(!res.bodyStartIndex) {
			res.bodyStartIndex = currentByteIdx
		}

		let bytesToCopy: number
		if(remainingBodyBytes === -1) {
			// all bytes are body bytes
			bytesToCopy = remaining.length
		} else {
			// take the number of bytes we need to read, or the number of bytes remaining
			// and append to the bytes of the body
			bytesToCopy = Math.min(remainingBodyBytes, remaining.length)
			remainingBodyBytes -= bytesToCopy
		}

		res.body = concatenateUint8Arrays([
			res.body,
			remaining.slice(0, bytesToCopy)
		])
		remaining = remaining.slice(bytesToCopy)
		currentByteIdx += bytesToCopy
	}

	function getLine() {
		// find end of line, if it exists
		// otherwise return undefined
		const idx = findIndexInUint8Array(remaining, HTTP_HEADER_LINE_END)
		if(idx === -1) {
			return undefined
		}

		const line = uint8ArrayToStr(remaining.slice(0, idx))
		remaining = remaining.slice(idx + HTTP_HEADER_LINE_END.length)

		currentByteIdx += idx + HTTP_HEADER_LINE_END.length

		return line
	}
}

/**
 * Finds all application data messages in a transcript
 * and returns them. Removes the "contentType" suffix from the message.
 * in TLS 1.3
 */
export function extractApplicationDataMsgsFromTranscript(
	{ transcript, tlsVersion }: TLSReceipt,
) {
	const msgs: ApplicationMessage[] = []
	for(const m of transcript) {
		if(m.packetHeader[0] !== PACKET_TYPE.WRAPPED_RECORD) {
			continue
		}

		let data: Uint8Array
		// redacted msgs but with a valid packet header
		// can be considered application data messages
		if(m.redacted) {
			if(!m.plaintextLength) {
				data = DEFAULT_REDACTION_DATA
			} else {
				const len = tlsVersion === TLSVersion.TLS_VERSION_1_3
				// remove content type suffix
					? m.plaintextLength - 1
					: m.plaintextLength
				data = new Uint8Array(len)
					.fill(REDACTION_CHAR_CODE)
			}
			// otherwise, we need to check the content type
		} else if(tlsVersion === TLSVersion.TLS_VERSION_1_3) {
			const contentType = m.message[m.message.length - 1]
			if(contentType !== CONTENT_TYPE_MAP['APPLICATION_DATA']) {
				continue
			}

			data = m.message.slice(0, -1)
		} else {
			data = m.message
		}

		msgs.push({ data, sender: m.senderType })
	}

	return msgs
}

/**
 * Read the HTTP request from a TLS receipt transcript.
 * @param receipt the transcript to read from or application messages if they were extracted beforehand
 * @returns the parsed HTTP request
 */
export function getHttpRequestDataFromTranscript(receipt: Transcript<Uint8Array>) {
	const clientMsgs = receipt
		.filter(s => s.sender === 'client')

	// if the first message is redacted, we can't parse it
	// as we don't know what the request was
	if(clientMsgs[0].message[0] === REDACTION_CHAR_CODE) {
		throw new Error('First client message request is redacted. Cannot parse')
	}

	const request: HttpRequest = {
		method: '',
		url: '',
		protocol: '',
		headers: {}
	}
	let requestBuffer = concatenateUint8Arrays(clientMsgs.map(m => m.message))
	// keep reading lines until we get to the end of the headers
	for(let line = getLine(); typeof line !== 'undefined'; line = getLine()) {
		if(line === '') {
			break
		}

		if(!request.method) {
			const [, method, url, protocol] = line.match(/(\w+) (.*) (.*)/) || []
			request.method = method.toLowerCase()
			request.url = url
			request.protocol = protocol
		} else {
			let keyIdx = line.indexOf(':')
			if(keyIdx === -1) {
				keyIdx = line.length - 1
			}

			const key = line.slice(0, keyIdx)
				.toLowerCase()
				.trim()
			const value = line.slice(keyIdx + 1)
				.trim()
			const oldValue = request.headers[key]
			if(typeof oldValue === 'string') {
				request.headers[key] = [oldValue, value]
			} else if(Array.isArray(oldValue)) {
				oldValue.push(value)
			} else {
				request.headers[key] = value
			}
		}
	}

	//the rest is request body
	if(requestBuffer.length) {
		request.body = requestBuffer
	}

	if(!request.method) {
		throw new Error('Client request is incomplete')
	}

	return request

	function getLine() {
		const idx = findIndexInUint8Array(requestBuffer, HTTP_HEADER_LINE_END)
		if(idx === -1) {
			return undefined
		}

		const line = uint8ArrayToStr(requestBuffer.slice(0, idx))
		requestBuffer = requestBuffer
			.slice(idx + HTTP_HEADER_LINE_END.length)

		return line
	}
}