import {
	CipherSuite,
	concatenateUint8Arrays, getSignatureDataTls12, getSignatureDataTls13,
	parseCertificates, parseClientHello, parseServerCertificateVerify, parseServerHello, processServerKeyShare,
	readWithLength,
	SUPPORTED_RECORD_TYPE_MAP, verifyCertificateSignature, X509Certificate
} from '@reclaimprotocol/tls'
import { verifyCertificateChain } from '@reclaimprotocol/tls/lib/utils/parse-certificate'
import { IDecryptedTranscript } from '../../types'
import { extractHandshakeFromTranscript } from '../../utils'


const RECORD_LENGTH_BYTES = 3

export async function verifyServerCertificates(receipt: IDecryptedTranscript, logger) {
	const handshakeMsgs = extractHandshakeFromTranscript(receipt)
	let handshakeData = concatenateUint8Arrays(handshakeMsgs.map(m => m.message))
	let packetData: ReturnType<typeof readPacket>
	const handshakeRawMessages: Uint8Array[] = []
	const certificates: X509Certificate[] = []
	let cipherSuite: CipherSuite | undefined = undefined
	let serverRandom: Uint8Array | undefined = undefined
	let clientRandom: Uint8Array | undefined = undefined

	let certVerified = false
	while((packetData = readPacket()) && !certVerified) {
		const { type, content } = packetData

		switch (type) {
		case SUPPORTED_RECORD_TYPE_MAP.CLIENT_HELLO:
			const clientHello = parseClientHello(handshakeRawMessages[0])
			clientRandom = clientHello.serverRandom
			break


		case SUPPORTED_RECORD_TYPE_MAP.SERVER_HELLO:
			const serverHello = await parseServerHello(content)
			cipherSuite = serverHello.cipherSuite
			serverRandom = serverHello.serverRandom
			break


		case SUPPORTED_RECORD_TYPE_MAP.CERTIFICATE:
			const parseResult = parseCertificates(content, { version:receipt.tlsVersion })
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
			await verifyCertificateChain(certificates, receipt.hostname)
			logger.info({ host:receipt.hostname }, 'verified provider certificate chain')
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
			await verifyCertificateChain(certificates, receipt.hostname)
			logger.info({ host:receipt.hostname }, 'verified provider certificate chain')
			certVerified = true
			break
		}

	}

	if(!certVerified) {
		throw new Error('No provider certificates received')
	}


	function readPacket() {
		if(!handshakeData.length) {
			return
		}

		const type = handshakeData[0]
		const content = readWithLength(handshakeData.slice(1), RECORD_LENGTH_BYTES)
		if(!content) {
			logger.warn('missing bytes from packet')
			return
		}

		const totalLength = 1 + RECORD_LENGTH_BYTES + content.length
		handshakeRawMessages.push(handshakeData.slice(0, totalLength))
		handshakeData = handshakeData.slice(totalLength)

		return { type, content }
	}

}