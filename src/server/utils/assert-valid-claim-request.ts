import {
	areUint8ArraysEqual,
	concatenateUint8Arrays,
	crypto,
	decryptWrappedRecord,
	PACKET_TYPE, parseClientHello,
	parseServerHello, SUPPORTED_CIPHER_SUITE_MAP
} from '@reclaimprotocol/tls'
import {
	ClaimTunnelRequest,
	InitRequest,
	ProviderClaimInfo,
	TranscriptMessageSenderType,
	ZKProofEngine
} from 'src/proto/api'
import { providers } from 'src/providers'
import { niceParseJsonObject } from 'src/server/utils/generics'
import { verifyServerCertificates } from 'src/server/utils/verify-server-certificates'
import {
	IDecryptedTranscript,
	IDecryptedTranscriptMessage,
	Logger,
	ProviderName,
	TCPSocketProperties,
	Transcript, ZKEngine
} from 'src/types'
import {
	assertValidateProviderParams,
	canonicalStringify,
	extractApplicationDataFromTranscript, hashProviderParams,
	verifyZkPacket,
	WitnessError
} from 'src/utils'
import { SIGNATURES } from 'src/utils/signatures'

/**
 * Asserts that the claim request is valid.
 *
 * 1. We begin by verifying the signature of the claim request.
 * 2. Next, we produce the transcript of the TLS exchange
 * from the proofs provided by the client.
 * 3. We then pull the provider the client is trying to claim
 * from
 * 4. We then use the provider's verification function to verify
 *  whether the claim is valid.
 *
 * If any of these steps fail, we throw an error.
 */
export async function assertValidClaimRequest(
	request: ClaimTunnelRequest,
	metadata: InitRequest,
	logger: Logger
) {
	const {
		data,
		signatures: { requestSignature } = {},
		zkEngine
	} = request
	if(!data) {
		throw new WitnessError(
			'WITNESS_ERROR_INVALID_CLAIM',
			'No info provided on claim request'
		)
	}

	if(!requestSignature?.length) {
		throw new WitnessError(
			'WITNESS_ERROR_INVALID_CLAIM',
			'No signature provided on claim request'
		)
	}

	// verify request signature
	const serialisedReq = ClaimTunnelRequest
		.encode({ ...request, signatures: undefined })
		.finish()
	const { verify: verifySig } = SIGNATURES[metadata.signatureType]
	const verified = await verifySig(
		serialisedReq,
		requestSignature,
		data.owner
	)
	if(!verified) {
		throw new WitnessError(
			'WITNESS_ERROR_INVALID_CLAIM',
			'Invalid signature on claim request'
		)
	}

	let receipt = await decryptTranscript(
		request.transcript,
		logger,
		zkEngine === ZKProofEngine.ZK_ENGINE_GNARK ? 'gnark' : 'snarkJS'
	)
	const reqHost = request.request?.host
	if(receipt.hostname !== reqHost) {
		throw new Error(
			`Expected server name ${reqHost}, got ${receipt.hostname}`
		)
	}

	receipt = await verifyServerCertificates(receipt, logger)

	// get all application data messages
	const applData = extractApplicationDataFromTranscript(receipt)
	const newData = await assertValidProviderTranscript(applData, data)
	if(newData !== data) {
		logger.info({ newData }, 'updated claim info')
	}

	return newData
}

/**
 * Verify that the transcript contains a valid claim
 * for the provider.
 */
export async function assertValidProviderTranscript<T extends ProviderClaimInfo>(
	applData: Transcript<Uint8Array>,
	info: T,
) {
	const providerName = info.provider as ProviderName
	const provider = providers[providerName]
	if(!provider) {
		throw new WitnessError(
			'WITNESS_ERROR_INVALID_CLAIM',
			`Unsupported provider: ${providerName}`
		)
	}

	const params = niceParseJsonObject(info.parameters, 'params')
	const ctx = niceParseJsonObject(info.context, 'context')

	assertValidateProviderParams(providerName, params)

	const rslt = await provider.assertValidProviderReceipt(
		applData,
		params
	)

	const extractedParameters = rslt?.extractedParameters || {}
	if(!Object.keys(extractedParameters).length) {
		return info
	}

	const newInfo = { ...info }
	ctx.extractedParameters = extractedParameters
	ctx.providerHash = hashProviderParams(params)
	newInfo.context = canonicalStringify(ctx) ?? ''

	return newInfo
}

/**
 * Verify that the transcript provided by the client
 * matches the transcript of the tunnel, the server
 * has created.
 */
export function assertTranscriptsMatch(
	clientTranscript: ClaimTunnelRequest['transcript'],
	tunnelTranscript: TCPSocketProperties['transcript']
) {
	const clientSends = concatenateUint8Arrays(
		clientTranscript
			.filter(m => m.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT)
			.map(m => m.message)
	)

	const tunnelSends = concatenateUint8Arrays(
		tunnelTranscript
			.filter(m => m.sender === 'client')
			.map(m => m.message)
	)

	if(!areUint8ArraysEqual(clientSends, tunnelSends)) {
		throw WitnessError.badRequest(
			'Outgoing messages from client do not match the tunnel transcript'
		)
	}

	const clientRecvs = concatenateUint8Arrays(
		clientTranscript
			.filter(m => m.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER)
			.map(m => m.message)
	)

	const tunnelRecvs = concatenateUint8Arrays(
		tunnelTranscript
			.filter(m => m.sender === 'server')
			.map(m => m.message)
	)
		// We only need to compare the first N messages
		// that the client claims to have received
		// the rest are not relevant -- so even if they're
		// not present in the tunnel transcript, it's fine
		.slice(0, clientRecvs.length)
	if(!areUint8ArraysEqual(clientRecvs, tunnelRecvs)) {
		throw WitnessError.badRequest(
			'Incoming messages from server do not match the tunnel transcript'
		)
	}
}

export async function decryptTranscript(
	transcript: ClaimTunnelRequest['transcript'],
	logger: Logger,
	zkEngine: ZKEngine
): Promise<IDecryptedTranscript> {
	// first server packet is hello packet
	const { serverTlsVersion, cipherSuite, } = await getServerHello()

	logger.info(
		{ serverTlsVersion, cipherSuite },
		'extracted server hello params'
	)

	const clientHello = getClientHello()
	const { SERVER_NAME: sni } = clientHello.extensions
	const hostname = sni?.serverName
	if(!hostname) {
		throw new Error('client hello has no SNI')
	}

	// use this to determine encrypted packets on TLS1.2
	const changeCipherSpecMsgIdx = serverTlsVersion === 'TLS1_2'
		? transcript.findIndex(p => (
			p.message[0] === PACKET_TYPE['CHANGE_CIPHER_SPEC']
		))
		: -1
	const mappedTranscriptResults = await Promise.allSettled(
		transcript.map(async({
			sender,
			message,
			reveal: { zkReveal, directReveal } = {}
		}, i): Promise<IDecryptedTranscriptMessage> => {
			const isEncrypted = isEncryptedPacket(i)

			if(
				// if someone provided a reveal, but the packet
				// is not encrypted, it's probably a mistake
				!isEncrypted
				&& (zkReveal?.proofs?.length || directReveal?.key?.length)
			) {
				throw new Error('packet not encrypted, but has a reveal')
			}

			let redacted = isEncrypted
			let plaintext: Uint8Array
			let plaintextLength: number

			const recordHeader = message.slice(0, 5)
			const content = getWithoutHeader(message)

			if(directReveal?.key?.length) {
				const { key, iv, recordNumber } = directReveal
				const { cipher } = SUPPORTED_CIPHER_SUITE_MAP[cipherSuite]
				const importedKey = await crypto.importKey(cipher, key)
				const result = await decryptWrappedRecord(
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

				redacted = false
				plaintext = result.plaintext
				plaintextLength = plaintext.length
			} else if(zkReveal?.proofs?.length) {
				const result = await verifyZkPacket(
					{
						ciphertext: content,
						zkReveal,
						logger,
						cipherSuite,
						zkEngine: zkEngine
					}
				)
				plaintext = result.redactedPlaintext
				redacted = false
				plaintextLength = plaintext.length
			} else {
				plaintext = getWithoutHeader(message)
				plaintextLength = plaintext.length
			}

			return {
				sender: sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
					? 'client'
					: 'server',
				redacted,
				message: plaintext,
				recordHeader,
				plaintextLength,
			}
		})
	)

	const mappedTranscript = mappedTranscriptResults.map((r, i) => {
		if(r.status === 'fulfilled') {
			return r.value
		}

		logger?.error({ i, err: r.reason }, 'error in handling packet')
		throw new WitnessError(
			'WITNESS_ERROR_INVALID_CLAIM',
			`error in handling packet at idx ${i}: ${r.reason.message}`,
			{
				packetIdx: i,
				error: r.reason,
			}
		)
	})

	return {
		transcript: mappedTranscript,
		hostname,
		tlsVersion: serverTlsVersion,
	}

	function isEncryptedPacket(pktIdx: number) {
		const { message } = transcript[pktIdx]
		if(message[0] === PACKET_TYPE['WRAPPED_RECORD']) {
			return true
		}

		// msg is after change cipher spec
		return changeCipherSpecMsgIdx >= 0
			&& pktIdx > changeCipherSpecMsgIdx
	}

	function getServerHello() {
		// first server packet is hello packet
		const serverHelloPacket = transcript.find(
			p => p.sender === TranscriptMessageSenderType
				.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
		)
		if(!serverHelloPacket) {
			throw new Error('session has no server hello params')
		}

		// strip the record header & packet prefix (02 00 00 97)
		// & parse the message
		const message = getWithoutHeader(serverHelloPacket.message)
			.slice(4)
		return parseServerHello(message)
	}

	function getClientHello() {
		// first client packet is hello packet
		const message = getWithoutHeader(transcript[0].message)
		return parseClientHello(message)
	}
}

export function getWithoutHeader(message: Uint8Array) {
	// strip the record header (xx 03 03 xx xx)
	return message.slice(5)
}


