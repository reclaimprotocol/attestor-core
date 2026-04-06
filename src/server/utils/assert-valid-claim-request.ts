import { areUint8ArraysEqual, concatenateUint8Arrays } from '@reclaimprotocol/tls'
import type { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'

import type {
	InitRequest,
	MessageReveal_MessageRevealDirect as MessageRevealDirect,
	MessageReveal_MessageRevealZk as MessageRevealZk,
	ProviderClaimInfo
} from '#src/proto/api.ts'
import { ClaimTunnelRequest, TranscriptMessageSenderType } from '#src/proto/api.ts'
import { providers } from '#src/providers/index.ts'
import { niceParseJsonObject } from '#src/server/utils/generics.ts'
import { computeOPRFRaw } from '#src/server/utils/oprf-raw.ts'
import { processHandshake } from '#src/server/utils/process-handshake.ts'
import { assertValidateProviderParams } from '#src/server/utils/validation.ts'
import type {
	IDecryptedTranscript,
	IDecryptedTranscriptMessage,
	Logger,
	OPRFRawReplacement,
	ProviderCtx,
	ProviderName,
	TCPSocketProperties,
	Transcript,
} from '#src/types/index.ts'
import {
	AttestorError,
	binaryHashToStr,
	canonicalStringify,
	decryptDirect,
	extractApplicationDataFromTranscript,
	hashProviderParams,
	SIGNATURES,
	verifyZkPacket
} from '#src/utils/index.ts'
import { getEngineString } from '#src/utils/zk.ts'

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
	const verified = await verifySig(serialisedReq, requestSignature, data.owner)
	if(!verified) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			'Invalid signature on claim request'
		)
	}

	const receipt = await decryptTranscript(
		request.transcript,
		logger,
		getEngineString(zkEngine),
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
		applData, data, logger, { version: metadata.clientVersion },
		receipt.oprfRawReplacements
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
	providerCtx: ProviderCtx,
	oprfRawReplacements?: OPRFRawReplacement[]
) {
	const providerName = info.provider as ProviderName
	const provider = providers[providerName]
	if(!provider) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			`Unsupported provider: ${providerName}`
		)
	}

	let params = niceParseJsonObject(info.parameters, 'params')
	const ctx = niceParseJsonObject(info.context, 'context')

	// Apply oprf-raw replacements to parameters (server-side OPRF)
	if(oprfRawReplacements?.length) {
		let strParams = canonicalStringify(params) ?? '{}'
		for(const { originalText, nullifierText } of oprfRawReplacements) {
			strParams = strParams.replaceAll(originalText, nullifierText)
		}

		params = JSON.parse(strParams)
		// Update info.parameters with replaced values
		info.parameters = strParams
		logger.debug(
			{ replacements: oprfRawReplacements.length },
			'applied oprf-raw parameter replacements'
		)
	}

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
	const {
		tlsVersion, cipherSuite, hostname, nextMsgIndex
	} = await processHandshake(transcript, logger)

	// TLS 1.3 has already one record encrypted at this point
	let clientRecordNumber = tlsVersion === 'TLS1_3' ? -1 : 0
	let serverRecordNumber = clientRecordNumber

	transcript = transcript.slice(nextMsgIndex)

	const overshotMap: { [pkt: number]: { data: Uint8Array } } = {}
	const decryptedTranscript: IDecryptedTranscriptMessage[] = []
	const oprfRawReplacements: { originalText: string, nullifierText: string }[] = []
	// Track pending oprf-raw markers that span multiple packets
	// keyed by packet index that will receive the overshot data
	const pendingOprfRaw: {
		[nextPktIdx: number]: {
			partialData: Uint8Array
			dataLocation: { fromIndex: number, length: number }
			originPktIdx: number
		}
	} = {}

	for(const [i, {
		sender,
		message,
		reveal: { zkReveal, directReveal } = {}
	}] of transcript.entries()) {
		try {
			//start with first message after last handshake message
			await decryptMessage(sender, message, directReveal, zkReveal, i)
		} catch(error) {
			const err = new AttestorError(
				'ERROR_INVALID_CLAIM',
				`error in handling packet at idx ${i}: ${error}`,
				{ packetIdx: i, error }
			)
			if(error.stack) {
				err.stack = error.stack
			}

			throw err
		}
	}

	// Fail if any oprf-raw markers remain incomplete
	const remainingPending = Object.keys(pendingOprfRaw)
	if(remainingPending.length) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			`oprf-raw cross-block markers incomplete: pending for packets ${remainingPending.join(', ')}`
		)
	}

	return {
		transcript: decryptedTranscript,
		hostname: hostname,
		tlsVersion: tlsVersion,
		oprfRawReplacements: oprfRawReplacements.length ? oprfRawReplacements : undefined
	}

	async function decryptMessage(
		sender: TranscriptMessageSenderType,
		message: Uint8Array,
		directReveal: MessageRevealDirect | undefined,
		zkReveal: MessageRevealZk | undefined,
		i: number
	) {
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
				directReveal, cipherSuite, recordHeader, tlsVersion, content
			)
			plaintext = result.plaintext
			redacted = false
			plaintextLength = plaintext.length
		} else if(zkReveal?.proofs?.length) {
			const iv = sender === TranscriptMessageSenderType
				.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
				? serverIV
				: clientIV
			const recordNumber = isServer
				? serverRecordNumber
				: clientRecordNumber

			const result = await verifyZkPacket(
				{
					ciphertext: content,
					zkReveal,
					iv,
					recordNumber,
					toprfOvershotNullifier: overshotMap[i]?.data,
					getNextPacket(overshot) {
						const nextIdx = transcript
							.findIndex((t, j) => t.sender === sender && j > i)
						if(nextIdx < 0) {
							return
						}

						overshotMap[nextIdx] = { data: overshot }
						return getWithoutHeader(transcript[nextIdx].message)
					},
					logger,
					cipherSuite,
					zkEngine: zkEngine,
				}
			)
			plaintext = result.redactedPlaintext

			// Handle pending oprf-raw data from previous packet (cross-block)
			const pendingForThis = pendingOprfRaw[i]
			if(pendingForThis && zkReveal?.overshotOprfRawLength) {
				const overshootLen = zkReveal.overshotOprfRawLength
				// Collect the overshot plaintext from this packet
				const overshootData = plaintext.slice(0, overshootLen)
				const fullData = concatenateUint8Arrays([
					pendingForThis.partialData,
					overshootData
				])

				// Verify accumulated length matches declared length
				const expectedLen = pendingForThis.dataLocation.length
				if(fullData.length !== expectedLen) {
					throw new AttestorError(
						'ERROR_INVALID_CLAIM',
						`oprf-raw cross-block length mismatch: got ${fullData.length}, expected ${expectedLen}`
					)
				}

				// Compute OPRF for the complete data
				const oprfResults = await computeOPRFRaw(
					fullData,
					[{ dataLocation: { fromIndex: 0, length: fullData.length } }],
					logger
				)

				if(oprfResults.length) {
					const { nullifier } = oprfResults[0]
					const originalText = new TextDecoder().decode(fullData)
					const nullifierStr = binaryHashToStr(nullifier, fullData.length)
					oprfRawReplacements.push({ originalText, nullifierText: nullifierStr })

					// Replace in original packet (handled when that packet was processed)
					// Replace in current packet
					const nullifierBytes = new TextEncoder().encode(nullifierStr)
					const overshootNullifier = nullifierBytes.slice(pendingForThis.partialData.length)
					plaintext.set(overshootNullifier, 0)

					// Also need to update the previous packet's plaintext
					// The previous packet has the first part of the nullifier
					const prevPkt = decryptedTranscript[pendingForThis.originPktIdx]
					if(prevPkt) {
						const firstPartNullifier = nullifierBytes.slice(0, pendingForThis.partialData.length)
						prevPkt.message.set(firstPartNullifier, pendingForThis.dataLocation.fromIndex)
					}
				}

				delete pendingOprfRaw[i]
			}

			// Process oprf-raw markers: compute OPRF server-side and replace with nullifier
			if(result.oprfRawMarkers?.length) {
				const { markersThisPacket, pendingMarker } = separateOprfRawMarkers(
					result.oprfRawMarkers,
					plaintext.length,
					() => transcript.findIndex((t, j) => t.sender === sender && j > i),
					decryptedTranscript.length,
					logger
				)

				// Store pending marker for cross-block processing
				if(pendingMarker) {
					// Copy partial data from plaintext
					pendingMarker.pending.partialData.set(
						plaintext.slice(pendingMarker.pending.dataLocation.fromIndex)
					)
					pendingOprfRaw[pendingMarker.nextIdx] = pendingMarker.pending
				}

				// Process markers that fit in this packet
				if(markersThisPacket.length) {

					const pt = plaintext!
					const oprfResults = await computeOPRFRaw(pt, markersThisPacket, logger)

					// Capture all original texts BEFORE any replacements
					// to avoid reading corrupted data when markers are adjacent
					const originalTexts = oprfResults.map(({ dataLocation }) => new TextDecoder().decode(
						pt.slice(dataLocation.fromIndex, dataLocation.fromIndex + dataLocation.length)
					))

					// Now replace plaintext at marker positions with nullifier string
					for(const [idx, { dataLocation, nullifier }] of oprfResults.entries()) {
						const originalText = originalTexts[idx]
						const nullifierStr = binaryHashToStr(nullifier, dataLocation.length)
						oprfRawReplacements.push({ originalText, nullifierText: nullifierStr })

						const nullifierBytes = new TextEncoder().encode(nullifierStr)
						pt.set(nullifierBytes, dataLocation.fromIndex)
					}
				}
			}

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
	}
}

export function getWithoutHeader(message: Uint8Array) {
	// strip the record header (xx 03 03 xx xx)
	return message.slice(5)
}

type PendingOprfRaw = {
	partialData: Uint8Array
	dataLocation: { fromIndex: number, length: number }
	originPktIdx: number
}

type ProcessOprfRawMarkersResult = {
	markersThisPacket: { dataLocation: { fromIndex: number, length: number } }[]
	pendingMarker?: { nextIdx: number, pending: PendingOprfRaw }
}

/**
 * Separate oprf-raw markers into those that fit in current packet
 * vs those that span to the next packet
 */
function separateOprfRawMarkers(
	markers: { dataLocation?: { fromIndex: number, length: number } }[],
	plaintextLength: number,
	findNextPacketIdx: () => number,
	currentTranscriptLength: number,
	logger: Logger
): ProcessOprfRawMarkersResult {
	const markersThisPacket: { dataLocation: { fromIndex: number, length: number } }[] = []
	let pendingMarker: ProcessOprfRawMarkersResult['pendingMarker']

	for(const marker of markers) {
		const dataLocation = marker.dataLocation
		if(!dataLocation) {
			continue
		}

		const { fromIndex, length } = dataLocation
		const endInPacket = fromIndex + length

		if(endInPacket <= plaintextLength) {
			markersThisPacket.push({ dataLocation })
			continue
		}

		// Spans to next packet
		const nextIdx = findNextPacketIdx()
		if(nextIdx < 0) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				'oprf-raw marker spans packets but no next packet found'
			)
		}

		pendingMarker = {
			nextIdx,
			pending: {
				partialData: new Uint8Array(plaintextLength - fromIndex),
				dataLocation: { fromIndex, length },
				originPktIdx: currentTranscriptLength
			}
		}

		logger.debug(
			{ fromIndex, length, partialLen: plaintextLength - fromIndex, nextIdx },
			'oprf-raw marker spans packets, storing partial data'
		)
	}

	return { markersThisPacket, pendingMarker }
}


