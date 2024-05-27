import { areUint8ArraysEqual, CipherSuite, SUPPORTED_CIPHER_SUITE_MAP } from '@reclaimprotocol/tls'
import { retryMiddleware } from 'nice-grpc-client-middleware-retry'
import { ClientError } from 'nice-grpc-common'
import { createChannel, createClientFactory } from 'nice-grpc-web'
import { ReclaimWitnessClient, ReclaimWitnessDefinition, TLSReceipt, TranscriptMessageSenderType } from '../proto/api'
import { ProviderField } from '../types'
import { extractApplicationDataMsgsFromTranscript } from './http-parser'
import { logger } from './logger'

export function uint8ArrayToStr(arr: Uint8Array) {
	return new TextDecoder().decode(arr)
}

export function getTranscriptString(receipt: TLSReceipt) {
	const applMsgs = extractApplicationDataMsgsFromTranscript(receipt)
	const strList: string[] = []
	for(const msg of applMsgs) {
		const sender = msg.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
			? 'client'
			: 'server'
		const content = uint8ArrayToStr(msg.data)
		if(strList[strList.length - 1]?.startsWith(sender)) {
			strList[strList.length - 1] += content
		} else {
			strList.push(`${sender}: ${content}`)
		}
	}

	return strList.join('\n')
}

export const unixTimestampSeconds = () => Math.floor(Date.now() / 1000)

export function createGrpcWebClient(url: string): ReclaimWitnessClient {
	const clientFactory = createClientFactory().use(retryMiddleware)
	const grpcChannel = createChannel(url)
	return clientFactory.create(
		ReclaimWitnessDefinition,
		grpcChannel,
		{ '*': {
			retryMaxAttempts: 3,
			retryMaxDelayMs:3000,
			onRetryableError(error: ClientError, attempt: number, delayMs: number) {
				logger.error(error, `Call failed (${attempt}), retrying in ${delayMs}ms`)
			},
		},
		pullFromSession:{
			retry:true
		},
		pushToSession:{
			retry:true
		},
		initialiseSession:{
			retry:true,
		},
		finaliseSession:{
			retry:true
		}, }

	)
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

/**
 * Fetch the ZK algorithm for the specified cipher suite
 */
export function getZkAlgorithmForCipherSuite(cipherSuite: CipherSuite) {
	if(cipherSuite.includes('CHACHA20')) {
		return 'chacha20'
	}

	if(cipherSuite.includes('AES_256_GCM')) {
		return 'aes-256-ctr'
	}

	if(cipherSuite.includes('AES_128_GCM')) {
		return 'aes-128-ctr'
	}

	throw new Error(`${cipherSuite} not supported for ZK ops`)
}

/**
 * Get the pure ciphertext without any MAC,
 * or authentication tag,
 * @param content content w/o header
 */
export function getPureCiphertext(
	content: Uint8Array,
	cipherSuite: CipherSuite
) {
	// assert that the cipher suite is supported
	getZkAlgorithmForCipherSuite(cipherSuite)

	// 16 => auth tag length
	content = content.slice(0, -16)

	const {
		ivLength: fixedIvLength,
	} = SUPPORTED_CIPHER_SUITE_MAP[cipherSuite]
	// 12 => total IV length
	const recordIvLength = 12 - fixedIvLength
	// record IV is prefixed to the ciphertext
	content = content.slice(recordIvLength)

	return content
}

export function getProviderValue<P, T>(params: P, fn: ProviderField<P, T>) {
	return typeof fn === 'function'
		// @ts-ignore
		? fn(params)
		: fn
}
