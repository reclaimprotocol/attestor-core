import {
	CipherSuite, concatenateUint8Arrays,
	getSignatureDataTls12,
	getSignatureDataTls13,
	PACKET_TYPE,
	parseCertificates,
	parseClientHello,
	parseServerCertificateVerify,
	parseServerHello,
	processServerKeyShare,
	SUPPORTED_RECORD_TYPE_MAP,
	TLSProtocolVersion, uint8ArrayToDataView,
	verifyCertificateSignature,
	X509Certificate
} from '@reclaimprotocol/tls'
import { verifyCertificateChain } from '@reclaimprotocol/tls/lib/utils/parse-certificate'
import { ClaimTunnelRequest, TranscriptMessageSenderType } from 'src/proto/api'
import { Logger } from 'src/types'
import { decryptDirect } from 'src/utils'


const RECORD_LENGTH_BYTES = 3

/**
 * Verifies server cert chain and removes handshake messages from transcript
 * @param receipt
 * @param logger
 */
export async function processHandshake(receipt: ClaimTunnelRequest['transcript'], logger: Logger) {
	let currentPacketIdx = 0
	let readPacketIdx = 0
	let handshakeData: Uint8Array = Uint8Array.from([])
	let packetData: Awaited<ReturnType<typeof readPacket>>
	const handshakeRawMessages: Uint8Array[] = []
	const certificates: X509Certificate[] = []
	let cipherSuite: CipherSuite | undefined = undefined
	let tlsVersion: TLSProtocolVersion | undefined = undefined
	let serverRandom: Uint8Array | undefined = undefined
	let clientRandom: Uint8Array | undefined = undefined
	let serverFinishedIdx = -1
	let clientFinishedIdx = -1
	let certVerified = false
	let hostname: string | undefined = undefined
	let clientChangeCipherSpecMsgIdx = -1
	let serverChangeCipherSpecMsgIdx = -1
	while((packetData = await readPacket())) {
		const { type, content } = packetData

		switch (type) {
		case SUPPORTED_RECORD_TYPE_MAP.CLIENT_HELLO:
			const clientHello = parseClientHello(handshakeRawMessages[0])
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
			const parseResult = parseCertificates(content, { version:tlsVersion! })
			certificates.push(...parseResult.certificates)
			break

		case SUPPORTED_RECORD_TYPE_MAP.CERTIFICATE_VERIFY:
			const signature = parseServerCertificateVerify(content)
			if(!certificates?.length) {
				throw new Error('No provider certificates received')
			}

			const signatureData = await getSignatureDataTls13(
				handshakeRawMessages.slice(0, -1),
                    cipherSuite!
			)
			await verifyCertificateSignature({
				...signature,
				publicKey: certificates[0].getPublicKey(),
				signatureData,
			})
			await verifyCertificateChain(certificates, hostname!)
			logger.info({ host:hostname }, 'verified provider certificate chain')
			certVerified = true
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
			await verifyCertificateChain(certificates, hostname!)
			logger.info({ host:hostname }, 'verified provider certificate chain')
			certVerified = true
			break


		case SUPPORTED_RECORD_TYPE_MAP.FINISHED:
			if(receipt[readPacketIdx].sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT) {
				clientFinishedIdx = readPacketIdx
			} else {
				serverFinishedIdx = readPacketIdx
			}

			break
		}
	}

	if(!certVerified) {
		throw new Error('No provider certificates received')
	}

	if(tlsVersion === 'TLS1_3' && serverFinishedIdx < 0) {
		throw new Error('server finished message not found')
	}

	if(tlsVersion === 'TLS1_2' && (serverChangeCipherSpecMsgIdx < 0 || clientChangeCipherSpecMsgIdx < 0)) {
		throw new Error('change cipher spec message not found')
	}


	async function readPacket(getMoreData = false) {
		if(currentPacketIdx > (receipt.length - 1)) {
			return
		}

		if(certVerified && serverFinishedIdx > 0 && clientFinishedIdx > 0) {
			return
		}

		readPacketIdx = currentPacketIdx
		if(!handshakeData?.length || getMoreData) {
			let newHandshakeData: Uint8Array
			const { message, reveal, sender } = receipt[currentPacketIdx]
			const recordHeader = message.slice(0, 5)
			const content = getWithoutHeader(message)

			if(message[0] === PACKET_TYPE['CHANGE_CIPHER_SPEC']) { //skip change cipher spec message

				if(sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT) {
					clientChangeCipherSpecMsgIdx = currentPacketIdx
				} else {
					serverChangeCipherSpecMsgIdx = currentPacketIdx
				}

				currentPacketIdx++
				return await readPacket()
			}


			if(message[0] === PACKET_TYPE['WRAPPED_RECORD'] ||
				(serverChangeCipherSpecMsgIdx > 0 && sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER) ||
				(clientChangeCipherSpecMsgIdx > 0 && sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT)) { // encrypted

				if(!tlsVersion || !cipherSuite) {
					throw new Error('Could not find cipherSuite to use')
				}

				if(!reveal?.directReveal?.key) {
					throw new Error('no direct reveal for handshake packet')
				}


				const { plaintext } = await decryptDirect(reveal?.directReveal, cipherSuite, recordHeader, tlsVersion, content)
				newHandshakeData = plaintext

				if(tlsVersion === 'TLS1_3') {
					newHandshakeData = newHandshakeData.slice(0, -1)
				}
			} else {
				newHandshakeData = content
			}

			handshakeData = concatenateUint8Arrays([handshakeData, newHandshakeData])
		}


		const type = handshakeData[0]
		const content = readWithLength(handshakeData.slice(1), RECORD_LENGTH_BYTES)
		if(!content) {
			logger.warn('missing bytes from packet')
			currentPacketIdx++
			return await readPacket(true)
		}

		const totalLength = 1 + RECORD_LENGTH_BYTES + content.length
		handshakeRawMessages.push(handshakeData.slice(0, totalLength))
		handshakeData = handshakeData.slice(totalLength)
		if(!handshakeData.length) {
			currentPacketIdx++
		}

		return { type, content }
	}

	const nextMsgIndex = Math.max(serverFinishedIdx, clientFinishedIdx) + 1

	return {
		tlsVersion: tlsVersion!,
		cipherSuite: cipherSuite!,
		hostname: hostname!,
		nextMsgIndex
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