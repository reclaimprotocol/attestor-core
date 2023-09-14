import { CommonTransport } from '@reclaimprotocol/common-grpc-web-transport'
import { areUint8ArraysEqual } from '@reclaimprotocol/tls'
import { createChannel, createClient } from 'nice-grpc-web'
import { ReclaimWitnessClient, ReclaimWitnessDefinition, TranscriptMessage, TranscriptMessageSenderType } from '../proto/api'
import { Logger } from '../types'

export function uint8ArrayToStr(arr: Uint8Array) {
	return new TextDecoder().decode(arr)
}

export function getTranscriptString(transcript: TranscriptMessage[]) {
	const strList: string[] = []
	for(const msg of transcript) {
		const sender = msg.senderType === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
			? 'client'
			: 'server'
		const content = msg.redacted
			? '****'
			: uint8ArrayToStr(msg.message)
		if(strList[strList.length - 1]?.startsWith(sender)) {
			strList[strList.length - 1] += content
		} else {
			strList.push(`${sender}: ${content}`)
		}
	}

	return strList.join('\n')
}

export const unixTimestampSeconds = () => Math.floor(Date.now() / 1000)

export function createGrpcWebClient(url: string, logger: Logger): ReclaimWitnessClient {
	const transportFactory = makeGrpcWebTransport(logger)
	const grpcChannel = createChannel(url, transportFactory)
	return createClient(
		ReclaimWitnessDefinition,
		grpcChannel,
		{ }
	)
}

export function makeGrpcWebTransport(logger?: Logger) {
	logger = logger?.child({ module: 'grpc-web-transport' })
	return CommonTransport({ logger })
}

/**
 * Find index of needle in haystack
 */
export function findIndexInUint8Array(
	haystack: Uint8Array,
	needle: Uint8Array,
) {
	for(let i = 0;i < haystack.length;i++) {
		if(areUint8ArraysEqual(haystack.slice(i, i + needle.length), needle)) {
			return i
		}
	}

	return -1
}

/**
 * convert a Uint8Array to a binary encoded str
 * from: https://github.com/feross/buffer/blob/795bbb5bda1b39f1370ebd784bea6107b087e3a7/index.js#L1063
 * @param buf
 * @returns
 */
export function uint8ArrayToBinaryStr(buf: Uint8Array) {
	let ret = ''
	buf.forEach(v => (
		ret += String.fromCharCode(v)
	))

	return ret
}

export function gunzipSync(buf: Uint8Array): Uint8Array {
	const { gunzipSync } = require('zlib')
	return gunzipSync(buf)
}