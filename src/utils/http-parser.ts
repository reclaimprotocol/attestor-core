import { areUint8ArraysEqual, concatenateUint8Arrays, strToUint8Array } from '@reclaimprotocol/tls'
import type { IncomingHttpHeaders } from 'http'
import { HTTPParser } from 'http-parser-js'
import { TLSReceipt, TranscriptMessageSenderType } from '../proto/api'
import { findIndexInUint8Array, uint8ArrayToStr } from './generics'
import { REDACTION_CHAR_CODE } from './redactions'

type HttpRequest = {
	method: string
	url: string
	protocol: string
	headers: IncomingHttpHeaders
}

type HttpResponse = {
	statusCode: number
	statusMessage: string
	headers: IncomingHttpHeaders
	body: Uint8Array
	headersComplete: boolean
	complete: boolean
}

export const CLIENT_CERTIFICATE_RESPONSE_CIPHERTEXT_SIZE = 37

const HTTP_REQ_PREFIX = strToUint8Array('HTTP/')

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
		headersComplete: false
	}

	const parser = new HTTPParser(HTTPParser.RESPONSE)
	parser.onHeadersComplete = (info) => {
		for(let i = 0;i < info.headers.length;i += 2) {
			res.headers[info.headers[i].toLowerCase()] =
				info.headers[i + 1]
		}

		res.statusCode = info.statusCode
		res.statusMessage = info.statusMessage
		res.headersComplete = true
	}

	parser.onBody = (chunk, offset, length) => {
		chunk = chunk.subarray(offset, offset + length)
		res.body = concatenateUint8Arrays([res.body, chunk])

		// hacky way to determine if the request is complete
		// this is essential, as some servers aren't sending the
		// content-length header nor chunked encoding
		if(
			res.headers['content-type']?.includes('text/html')
			&& uint8ArrayToStr(res.body.slice(-20))
				.trim()
				.endsWith('</html>')
		) {
			res.complete = true
		}
	}

	parser.onMessageComplete = () => {
		res.complete = true
	}

	return {
		res,
		/**
		 * Parse the next chunk of data
		 * @param data the data to parse
		 */
		onChunk(data: Uint8Array) {
			// @ts-expect-error
			parser.execute(data)
		},
		/**
		 * Call to prevent further parsing; indicating the end of the request
		 * Checks that the response is valid & complete, otherwise throws an error
		 */
		streamEnded() {
			parser.close()
			if(!res.headersComplete) {
				throw new Error('stream ended before headers were complete')
			}

			res.complete = true
		}
	}
}

/**
 * Extract the HTTP response from a TLS receipt transcript.
 * Will throw an error if the response is incomplete or redacted.
 * @returns the http response
 */
export function getCompleteHttpResponseFromTranscript(
	transcript: TLSReceipt['transcript']
) {
	const serverResponseBlocks: Uint8Array[] = []
	let srvResStartIdx = -1
	for(let i = 0;i < transcript.length;i++) {
		const msg = transcript[i]
		const content = msg.message
		if(
			msg.senderType === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
			// does the message start with HTTP/ ?
			&& areUint8ArraysEqual(
				content.slice(0, HTTP_REQ_PREFIX.length),
				HTTP_REQ_PREFIX
			)
		) {
			srvResStartIdx = i
			break
		}
	}

	if(srvResStartIdx < 0) {
		throw new Error('Could not find server response in transcript')
	}

	for(let i = srvResStartIdx;i < transcript.length;i++) {
		const msg = transcript[i]
		if(msg.senderType === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT) {
			break
		}

		if(msg.redacted) {
			break
		}

		serverResponseBlocks.push(msg.message)
	}

	const resParser = makeHttpResponseParser()
	for(const block of serverResponseBlocks) {
		resParser.onChunk(block)
	}

	if(!resParser.res.complete) {
		throw new Error('Server response is incomplete')
	}

	return resParser.res
}

/**
 * Read the HTTP request from a TLS receipt transcript.
 * Note: this currently does not read a body, only headers.
 *
 * @param transcript the transcript to read from
 * @returns the parsed HTTP request
 */
export function getHttpRequestHeadersFromTranscript(
	transcript: TLSReceipt['transcript']
) {
	// get the first provider message sent by the client
	// to get the same, we need to skip the first two messages sent by the client
	// (the client hello and the client finish)
	let clientSentMsgs = transcript
		.filter(m => m.senderType === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT)
		.slice(2)


	// case for client certificate request providers, they add an extra message
	// check for the redacted message size to make sure it's a handshake one
	// this is super hacky -- but well it works
	if(clientSentMsgs[0].redacted && clientSentMsgs[0].message?.length === CLIENT_CERTIFICATE_RESPONSE_CIPHERTEXT_SIZE) {
		clientSentMsgs = clientSentMsgs.slice(1)
	}

	// if the first message is redacted, we can't parse it
	// as we don't know what the request was
	if(clientSentMsgs[0].redacted) {
		throw new Error('First client message request is redacted. Cannot parse')
	}

	const buffers: Uint8Array[] = []
	for(const msg of clientSentMsgs) {
		if(msg.redacted) {
			buffers.push(DEFAULT_REDACTION_DATA)
		} else {
			buffers.push(msg.message)
		}
	}

	const request: HttpRequest = {
		method: '',
		url: '',
		protocol: '',
		headers: {},
	}

	let requestBuffer = concatenateUint8Arrays(buffers)
	// keep reading lines until we get to the end of the headers
	for(let line = getLine();typeof line !== 'undefined';line = getLine()) {
		if(line === '') {
			break
		}

		if(!request.method) {
			const [, method, url, protocol] = line.match(/(\w+) (.*) (.*)/) || []
			request.method = method.toLowerCase()
			request.url = url
			request.protocol = protocol
		} else {
			const [key, value] = line.split(': ')
			request.headers[key.toLowerCase()] = value
		}
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