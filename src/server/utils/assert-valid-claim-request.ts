import {
	areUint8ArraysEqual,
	concatenateUint8Arrays
} from '@reclaimprotocol/tls'
import { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import {
	ClaimTunnelRequest,
	InitRequest,
	MessageReveal_MessageRevealDirect as MessageRevealDirect,
	MessageReveal_MessageRevealZk as MessageRevealZk,
	ProviderClaimInfo,
	TranscriptMessageSenderType,
	ZKProofEngine
} from 'src/proto/api'
import { providers } from 'src/providers'
import { niceParseJsonObject } from 'src/server/utils/generics'
import { processHandshake } from 'src/server/utils/process-handshake'
import {
	IDecryptedTranscript, IDecryptedTranscriptMessage,
	Logger,
	ProviderCtx,
	ProviderName,
	TCPSocketProperties,
	Transcript,
} from 'src/types'
import {
	assertValidateProviderParams,
	AttestorError,
	canonicalStringify, decryptDirect,
	extractApplicationDataFromTranscript,
	hashProviderParams, verifyZkPacket
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
	logger: Logger,
) {
	const {
		data,
		signatures: { requestSignature } = {},
		zkEngine,
		fixedServerIV,
		fixedClientIV
	} = request
	if(!data) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'No info provided on claim request'
		)
	}

	if(!requestSignature?.length) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
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
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'Invalid signature on claim request'
		)
	}

	const receipt = await decryptTranscript(
		request.transcript,
		logger,
		zkEngine === ZKProofEngine.ZK_ENGINE_GNARK ? 'gnark' : 'snarkjs',
		fixedServerIV,
		fixedClientIV
	)
	const reqHost = request.request?.host
	if(receipt.hostname !== reqHost) {
		throw new Error(
			`Expected server name ${reqHost}, got ${receipt.hostname}`
		)
	}


	// get all application data messages
	const applData = extractApplicationDataFromTranscript(receipt)
	const newData = await assertValidProviderTranscript(
		applData, data, logger, { version: metadata.clientVersion }
	)
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
	logger: Logger,
	providerCtx: ProviderCtx
) {
	const providerName = info.provider as ProviderName
	const provider = providers[providerName]
	if(!provider) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			`Unsupported provider: ${providerName}`
		)
	}

	const params = niceParseJsonObject(info.parameters, 'params')
	const ctx = niceParseJsonObject(info.context, 'context')

	assertValidateProviderParams(providerName, params)

	const rslt = await provider.assertValidProviderReceipt({
		receipt: applData,
		params,
		logger,
		ctx: providerCtx
	})

	ctx.providerHash = hashProviderParams(params)

	const extractedParameters = rslt?.extractedParameters || {}
	if(Object.keys(extractedParameters).length) {
		ctx.extractedParameters = extractedParameters
	}

	info.context = canonicalStringify(ctx) ?? ''

	return info
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
		throw AttestorError.badRequest(
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
		throw AttestorError.badRequest(
			'Incoming messages from server do not match the tunnel transcript'
		)
	}
}

export async function decryptTranscript(
	transcript: ClaimTunnelRequest['transcript'],
	logger: Logger,
	zkEngine: ZKEngine,
	serverIV: Uint8Array,
	clientIV: Uint8Array,
): Promise<IDecryptedTranscript> {

	const { tlsVersion, cipherSuite, hostname, nextMsgIndex } = await processHandshake(transcript, logger)

	let clientRecordNumber = tlsVersion === 'TLS1_3' ? -1 : 0 // TLS 1.3 has already one record encrypted at this point
	let serverRecordNumber = clientRecordNumber

	transcript = transcript.slice(nextMsgIndex)

	const decryptedTranscript: IDecryptedTranscriptMessage[] = []

	for(const [i, {
		sender,
		message,
		reveal: { zkReveal, directReveal } = {}
	}] of transcript.entries()) {
		//start with first message after last handshake message
		await getDecryptedMessage(sender, message, directReveal, zkReveal, i)
	}

	return {
		transcript: decryptedTranscript,
		hostname: hostname,
		tlsVersion: tlsVersion,
	}

	async function getDecryptedMessage(
		sender: TranscriptMessageSenderType,
		message: Uint8Array,
		directReveal: MessageRevealDirect | undefined,
		zkReveal: MessageRevealZk | undefined,
		i: number
	) {
		try {
			const isServer = sender === TranscriptMessageSenderType
				.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
			const recordHeader = message.slice(0, 5)
			const content = getWithoutHeader(message)
			if(isServer) {
				serverRecordNumber++
			} else {
				clientRecordNumber++
			}

			let redacted = true
			let plaintext: Uint8Array | undefined = undefined
			let plaintextLength: number

			if(directReveal?.key?.length) {
				const result = await decryptDirect(
					directReveal, cipherSuite, recordHeader,
					tlsVersion, content
				)
				plaintext = result.plaintext
				redacted = false
				plaintextLength = plaintext.length
			} else if(zkReveal?.proofs?.length) {
				const result = await verifyZkPacket(
					{
						ciphertext: content,
						zkReveal,
						logger,
						cipherSuite,
						zkEngine: zkEngine,
						iv: sender === TranscriptMessageSenderType
							.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
							? serverIV
							: clientIV,
						recordNumber: isServer
							? serverRecordNumber
							: clientRecordNumber
					}
				)
				plaintext = result.redactedPlaintext
				redacted = false
				plaintextLength = plaintext.length
			} else {
				plaintext = content
				plaintextLength = plaintext.length
			}

			decryptedTranscript.push({
				sender: sender === TranscriptMessageSenderType
					.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
					? 'client'
					: 'server',
				redacted,
				message: plaintext,
				recordHeader,
				plaintextLength,
			})

		} catch(error) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`error in handling packet at idx ${i}: ${error}`,
				{
					packetIdx: i,
					error: error,
				}
			)
		}
	}
}

export function getWithoutHeader(message: Uint8Array) {
	// strip the record header (xx 03 03 xx xx)
	return message.slice(5)
}


