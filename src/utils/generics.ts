import { REDACTION_CHAR_CODE } from '@reclaimprotocol/circom-symmetric-crypto'
import {
	areUint8ArraysEqual,
	CipherSuite,
	CONTENT_TYPE_MAP,
	crypto, decryptWrappedRecord,
	PACKET_TYPE,
	strToUint8Array,
	SUPPORTED_CIPHER_SUITE_MAP, TLSProtocolVersion,
	uint8ArrayToDataView
} from '@reclaimprotocol/tls'
import { RPCMessage, RPCMessages } from 'src/proto/api'
import {
	CompleteTLSPacket,
	IDecryptedTranscript, IDecryptedTranscriptMessage,
	ProviderField,
	RPCEvent,
	RPCEventMap,
	RPCEventType,
	RPCType,
	Transcript
} from 'src/types'

const DEFAULT_REDACTION_DATA = new Uint8Array(4)
	.fill(REDACTION_CHAR_CODE)

export function uint8ArrayToStr(arr: Uint8Array) {
	return new TextDecoder().decode(arr)
}

export function getTranscriptString(receipt: IDecryptedTranscript) {
	const applMsgs = extractApplicationDataFromTranscript(receipt)
	const strList: string[] = []
	for(const { message, sender } of applMsgs) {
		const content = uint8ArrayToStr(message)
		if(strList[strList.length - 1]?.startsWith(sender)) {
			strList[strList.length - 1] += content
		} else {
			strList.push(`${sender}: ${content}`)
		}
	}

	return strList.join('\n')
}

export const unixTimestampSeconds = () => Math.floor(Date.now() / 1000)

/**
 * Find index of needle in haystack
 */
export function findIndexInUint8Array(
	haystack: Uint8Array,
	needle: Uint8Array,
) {
	for(let i = 0; i < haystack.length; i++) {
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
	for(const v of buf) {
		(
			ret += String.fromCharCode(v)
		)
	}

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
 * @param cipherSuite
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


/**
 * Get the 8 byte IV part that's stored in the record for some cipher suites
 * @param content content w/o header
 * @param cipherSuite
 */
export function getRecordIV(
	content: Uint8Array,
	cipherSuite: CipherSuite
) {
	// assert that the cipher suite is supported
	getZkAlgorithmForCipherSuite(cipherSuite)

	const {
		ivLength: fixedIvLength,
	} = SUPPORTED_CIPHER_SUITE_MAP[cipherSuite]
	// 12 => total IV length
	const recordIvLength = 12 - fixedIvLength
	return content.slice(0, recordIvLength)
}

export function getProviderValue<P, T>(params: P, fn: ProviderField<P, T>) {
	return typeof fn === 'function'
		// @ts-ignore
		? fn(params) as T
		: fn
}

export function generateRpcMessageId() {
	return uint8ArrayToDataView(
		crypto.randomBytes(8)
	).getUint32(0)
}

/**
 * Random session ID for a WebSocket client.
 */
export function generateSessionId() {
	return generateRpcMessageId()
}

/**
 * Random ID for a tunnel.
 */
export function generateTunnelId() {
	return generateRpcMessageId()
}

export function makeRpcEvent<T extends RPCEventType>(
	type: T,
	data: RPCEventMap[T]
) {
	const ev = new Event(type) as RPCEvent<T>
	ev.data = data
	return ev
}

/**
 * Get the RPC type from the key.
 * For eg. "claimTunnelRequest" ->
 *    { type: 'claimTunnel', direction: 'request' }
 */
export function getRpcTypeFromKey(key: string) {
	if(key.endsWith('Request')) {
		return {
			type: key.slice(0, -7) as RPCType,
			direction: 'request' as const
		}
	}

	if(key.endsWith('Response')) {
		return {
			type: key.slice(0, -8) as RPCType,
			direction: 'response' as const
		}
	}
}

/**
 * Get the RPC response type from the RPC type.
 * For eg. "claimTunnel" -> "claimTunnelResponse"
 */
export function getRpcResponseType<T extends RPCType>(type: T) {
	return `${type}Response` as const
}

/**
 * Get the RPC request type from the RPC type.
 * For eg. "claimTunnel" -> "claimTunnelRequest"
 */
export function getRpcRequestType<T extends RPCType>(type: T) {
	return `${type}Request` as const
}

export function isApplicationData(
	packet: CompleteTLSPacket,
	tlsVersion: string | undefined
) {
	return packet.type === 'ciphertext'
		&& (
			packet.contentType === 'APPLICATION_DATA'
			|| (
				packet.data[0] === PACKET_TYPE.WRAPPED_RECORD
				&& tlsVersion === 'TLS1_2'
			)
		)
}

/**
 * Convert the received data from a WS to a Uint8Array
 */
export async function extractArrayBufferFromWsData(
	data: unknown
): Promise<Uint8Array> {
	if(data instanceof ArrayBuffer) {
		return new Uint8Array(data)
	}

	// uint8array/Buffer
	if(typeof data === 'object' && data && 'buffer' in data) {
		return data as Uint8Array
	}

	if(typeof data === 'string') {
		return strToUint8Array(data)
	}

	if(data instanceof Blob) {
		return new Uint8Array(await data.arrayBuffer())
	}

	throw new Error('unsupported data: ' + String(data))
}

/**
 * Check if the RPC message is a request or a response.
 */
export function getRpcRequest(msg: RPCMessage) {
	if(msg.requestError) {
		return {
			direction: 'response' as const,
			type: 'error' as const
		}
	}

	for(const key in msg) {
		if(!msg[key]) {
			continue
		}

		const rpcType = getRpcTypeFromKey(key)
		if(!rpcType) {
			continue
		}

		return rpcType
	}
}

/**
 * Finds all application data messages in a transcript
 * and returns them. Removes the "contentType" suffix from the message.
 * in TLS 1.3
 */
export function extractApplicationDataFromTranscript(
	{ transcript, tlsVersion }: IDecryptedTranscript,
) {
	const msgs: Transcript<Uint8Array> = []
	for(const m of transcript) {
		let message: Uint8Array
		// redacted msgs but with a valid packet header
		// can be considered application data messages
		if(m.redacted) {
			if(!m.plaintextLength) {
				message = DEFAULT_REDACTION_DATA
			} else {
				const len = tlsVersion === 'TLS1_3'
					// remove content type suffix
					? m.plaintextLength - 1
					: m.plaintextLength
				message = new Uint8Array(len)
					.fill(REDACTION_CHAR_CODE)
			}
			// otherwise, we need to check the content type
		} else if(tlsVersion === 'TLS1_3') {
			const contentType = m.message[m.message.length - 1]
			if(contentType !== CONTENT_TYPE_MAP['APPLICATION_DATA']) {
				continue
			}

			message = m.message.slice(0, -1)
		} else if(m.recordHeader[0] === PACKET_TYPE.WRAPPED_RECORD) {
			message = m.message
		} else {
			continue
		}

		msgs.push({ message, sender: m.sender })
	}

	return msgs
}

export type HandshakeTranscript<T> = {
	sender: 'client' | 'server'
	index: number
	message: T
}[]

export function extractHandshakeFromTranscript(
	{ transcript, tlsVersion }: { transcript: IDecryptedTranscriptMessage[], tlsVersion: TLSProtocolVersion }
) {
	const msgs: HandshakeTranscript<Uint8Array> = []
	for(const [i, m] of transcript.entries()) {
		if(m.redacted) {
			break // stop at first encrypted message
		}

		let message: Uint8Array
		if(m.recordHeader[0] === PACKET_TYPE.HELLO) {
			message = m.message
		} else if(m.recordHeader[0] === PACKET_TYPE.WRAPPED_RECORD) {
			if(tlsVersion === 'TLS1_3') {
				const contentType = m.message[m.message.length - 1]
				if(contentType !== CONTENT_TYPE_MAP['HANDSHAKE']) {
					break
				}

				message = m.message.slice(0, -1)
			} else {
				break
			}
		} else {
			continue
		}

		if(!message.length) {
			throw new Error('unsupported handshake message')
		}

		msgs.push({ message, sender: m.sender, index: i })

	}

	return msgs
}

export async function decryptDirect(directReveal, cipherSuite: CipherSuite, recordHeader: Uint8Array, serverTlsVersion: TLSProtocolVersion, content: Uint8Array) {
	const { key, iv, recordNumber } = directReveal
	const { cipher } = SUPPORTED_CIPHER_SUITE_MAP[cipherSuite]
	const importedKey = await crypto.importKey(cipher, key)
	return await decryptWrappedRecord(
		content,
		{
			iv,
			key: importedKey,
			recordHeader,
			recordNumber,
			version: serverTlsVersion,
			cipherSuite,
		}
	)
}

export function packRpcMessages(...msgs: Partial<RPCMessage>[]) {
	return RPCMessages.create({
		messages: msgs.map(msg => (
			RPCMessage.create({
				...msg,
				id: msg.id || generateRpcMessageId()
			})
		))
	})
}

/**
 * Converts an Ethers struct (an array w named keys) to
 * a plain object. Recursively converts all structs inside.
 * Required to correctly JSON.stringify the struct.
 */
export function ethersStructToPlainObject<T>(struct: T): T {
	if(!Array.isArray(struct)) {
		return struct
	}

	const namedKeys = Object.keys(struct)
		.filter(key => isNaN(Number(key)))
	// seems to be an actual array
	if(!namedKeys.length) {
		return struct.map(ethersStructToPlainObject) as any
	}

	const obj: any = {}
	for(const key of namedKeys) {
		obj[key] = ethersStructToPlainObject(struct[key])
	}

	return obj
}