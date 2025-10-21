import type {
	CipherSuite,
	TLSProtocolVersion,
	X509Certificate } from '@reclaimprotocol/tls'
import {
	getSignatureDataTls12,
	getSignatureDataTls13,
	PACKET_TYPE,
	parseCertificates,
	parseClientHello,
	parseServerCertificateVerify,
	parseServerHello,
	processServerKeyShare,
	SUPPORTED_RECORD_TYPE_MAP, uint8ArrayToDataView,
	verifyCertificateChain,
	verifyCertificateSignature
} from '@reclaimprotocol/tls'

import type { ClaimTunnelRequest } from '#src/proto/api.ts'
import { TranscriptMessageSenderType } from '#src/proto/api.ts'
import type { Logger } from '#src/types/index.ts'
import { decryptDirect } from '#src/utils/index.ts'

const RECORD_LENGTH_BYTES = 3

type HandshakeMessage = {
	type: number
	content: Uint8Array
	contentWithHeader: Uint8Array
}

/**
 * Verifies server cert chain and removes handshake messages from transcript
 * @param receipt
 * @param logger
 */
export async function processHandshake(receipt: ClaimTunnelRequest['transcript'], logger: Logger) {
	const certificates: X509Certificate[] = []
	const handshakeRawMessages: Uint8Array[] = []

	let currentPacketIdx = 0
	let cipherSuite: CipherSuite | undefined = undefined
	let tlsVersion: TLSProtocolVersion | undefined = undefined
	let serverRandom: Uint8Array | undefined = undefined
	let clientRandom: Uint8Array | undefined = undefined
	let serverFinishedIdx = -1
	let clientFinishedIdx = -1
	let certVerified = false
	let certVerifyHandled = false
	let hostname: string | undefined = undefined
	let clientChangeCipherSpecMsgIdx = -1
	let serverChangeCipherSpecMsgIdx = -1
	while(serverFinishedIdx < 0 || clientFinishedIdx < 0) {
		const packetIdx = currentPacketIdx++
		if(packetIdx >= receipt.length) {
			throw new Error(
				'Receipt over but server finish: ' + serverFinishedIdx
				+ ', client finish: ' + clientFinishedIdx
			)
		}

		const { message, reveal, sender } = receipt[packetIdx]

		// skip change cipher spec message
		if(message[0] === PACKET_TYPE['CHANGE_CIPHER_SPEC']) {
			if(
				sender === TranscriptMessageSenderType
					.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
			) {
				clientChangeCipherSpecMsgIdx = packetIdx
				logger.trace('found client change cipher spec message')
			} else {
				serverChangeCipherSpecMsgIdx = packetIdx
				logger.trace('found server change cipher spec message')
			}

			continue
		}

		let plaintext: Uint8Array = getWithoutHeader(message)

		if(
			// decrypt if wrapped record or after change cipher spec message,
			// after which records are encrypted
			message[0] === PACKET_TYPE['WRAPPED_RECORD']
			|| (
				serverChangeCipherSpecMsgIdx > 0
					&& sender === TranscriptMessageSenderType
						.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
			)
			|| (
				clientChangeCipherSpecMsgIdx > 0
					&& sender === TranscriptMessageSenderType
						.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
			)
		) { // encrypted
			if(!tlsVersion || !cipherSuite) {
				throw new Error('Could not find cipherSuite to use & got enc record')
			}

			if(!reveal?.directReveal?.key) {
				throw new Error(
					'no direct reveal for handshake packet: ' + packetIdx
				)
			}

			const recordHeader = message.slice(0, 5);
			({ plaintext } = await decryptDirect(
				reveal?.directReveal,
				cipherSuite,
				recordHeader,
				tlsVersion,
				plaintext
			))

			if(tlsVersion === 'TLS1_3') {
				plaintext = plaintext.slice(0, -1)
			}
		}

		// each handshake packet may contain multiple handshake messages
		const handshakeMessages: HandshakeMessage[] = []
		for(let offset = 0; offset < plaintext.length;) {
			const type = plaintext[offset]
			const content = readWithLength(plaintext.slice(offset + 1), RECORD_LENGTH_BYTES)
			if(!content) {
				throw new Error('could not read pkt length')
			}

			handshakeMessages.push({
				type,
				content,
				contentWithHeader: plaintext
					.slice(offset, offset + 1 + RECORD_LENGTH_BYTES + content.length),
			})

			offset += 1 + RECORD_LENGTH_BYTES + content.length
		}

		for(const msg of handshakeMessages) {
			await processHandshakeMessage(msg, packetIdx)
			handshakeRawMessages.push(msg.contentWithHeader)
		}
	}

	if(!certVerified) {
		throw new Error('No provider certificates received')
	}

	if(tlsVersion === 'TLS1_3' && serverFinishedIdx < 0) {
		throw new Error('server finished message not found')
	}

	if(tlsVersion === 'TLS1_3' && !certVerifyHandled) {
		throw new Error('TLS1.3 cert verify packet not received')
	}

	if(tlsVersion === 'TLS1_2' && (serverChangeCipherSpecMsgIdx < 0 || clientChangeCipherSpecMsgIdx < 0)) {
		throw new Error('change cipher spec message not found')
	}

	const nextMsgIndex = Math.max(serverFinishedIdx, clientFinishedIdx) + 1

	return {
		tlsVersion: tlsVersion!,
		cipherSuite: cipherSuite!,
		hostname: hostname!,
		nextMsgIndex,
	}

	async function processHandshakeMessage(
		{ type, content, contentWithHeader }: HandshakeMessage, packetIdx: number
	) {
		switch (type) {
		case SUPPORTED_RECORD_TYPE_MAP.CLIENT_HELLO:
			const clientHello = parseClientHello(contentWithHeader)
			clientRandom = clientHello.serverRandom
			const { SERVER_NAME: sni } = clientHello.extensions
			hostname = sni?.serverName
			if(!hostname) {
				throw new Error('client hello has no SNI')
			}

			break
		case SUPPORTED_RECORD_TYPE_MAP.SERVER_HELLO:
			const serverHello = await parseServerHello(content)
			cipherSuite = serverHello.cipherSuite
			tlsVersion = serverHello.serverTlsVersion
			serverRandom = serverHello.serverRandom
			logger.info(
				{ serverTLSVersion: tlsVersion, cipherSuite },
				'extracted server hello params'
			)
			break
		case SUPPORTED_RECORD_TYPE_MAP.CERTIFICATE:
			const parseResult = parseCertificates(content, { version: tlsVersion! })
			certificates.push(...parseResult.certificates)

			await verifyCertificateChain(certificates, hostname!, logger)
			logger.info({ hostname }, 'verified provider certificate chain')
			certVerified = true
			break
		case SUPPORTED_RECORD_TYPE_MAP.CERTIFICATE_VERIFY:
			const signature = parseServerCertificateVerify(content)
			if(!certificates?.length) {
				throw new Error('No provider certificates received')
			}

			const signatureData = await getSignatureDataTls13(
				handshakeRawMessages, cipherSuite!
			)
			await verifyCertificateSignature({
				...signature,
				publicKey: certificates[0].getPublicKey(),
				signatureData,
			})

			certVerifyHandled = true
			break
		case SUPPORTED_RECORD_TYPE_MAP.SERVER_KEY_SHARE:
			if(!certificates?.length) {
				throw new Error('No provider certificates received')
			}

			const keyShare = await processServerKeyShare(content)
			const signatureData12 = await getSignatureDataTls12(
				{
					clientRandom: clientRandom!,
					serverRandom: serverRandom!,
					curveType: keyShare.publicKeyType,
					publicKey: keyShare.publicKey,
				},
			)
			// verify signature
			await verifyCertificateSignature({
				signature: keyShare.signatureBytes,
				algorithm: keyShare.signatureAlgorithm,
				publicKey: certificates[0].getPublicKey(),
				signatureData: signatureData12,
			})
			await verifyCertificateChain(certificates, hostname!, logger)
			logger.info({ hostname }, 'verified provider certificate chain')
			certVerified = true
			break
		case SUPPORTED_RECORD_TYPE_MAP.FINISHED:
			const packet = receipt[packetIdx]
			if(packet.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT) {
				clientFinishedIdx = packetIdx
			} else {
				serverFinishedIdx = packetIdx
			}

			break
		}
	}
}

function getWithoutHeader(message: Uint8Array) {
	// strip the record header (xx 03 03 xx xx)
	return message.slice(5)
}

function readWithLength(data: Uint8Array, lengthBytes = 2) {
	const dataView = uint8ArrayToDataView(data)
	const length = lengthBytes === 1
		? dataView.getUint8(0)
		: dataView.getUint16(lengthBytes === 3 ? 1 : 0)
	if(data.length < lengthBytes + length) {
		return undefined
	}

	return data.slice(lengthBytes, lengthBytes + length)
}