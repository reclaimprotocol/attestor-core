/**
 * TLS Transcript Reconstruction from TEE data
 */

import { ClaimTunnelRequest, TranscriptMessageSenderType } from 'src/proto/api'
import { TOutputPayload } from 'src/proto/tee-bundle'
import { Logger } from 'src/types'
import { SyntheticTranscriptMessage, TeeBundleData, TeeTranscriptData } from 'src/types/tee'
import { AttestorError } from 'src/utils'

/**
 * Reconstructs TLS transcript from TEE bundle data
 * @param bundleData - Validated TEE bundle data
 * @param logger - Logger instance
 * @returns Reconstructed transcript data
 */
export async function reconstructTlsTranscript(
	bundleData: TeeBundleData,
	logger: Logger
): Promise<TeeTranscriptData> {
	try {
		// Extract cipher suite from handshake keys if available
		const cipherSuite = bundleData.handshakeKeys?.cipherSuite
		const isTLS12AESGCM = cipherSuite ? isTLS12AESGCMCipherSuite(cipherSuite) : false

		// 1. Reconstruct request using proof stream
		const revealedRequest = reconstructRequest(bundleData, logger)

		// 2. Reconstruct response using redacted streams
		const responseData = reconstructResponse(bundleData, isTLS12AESGCM, logger)

		// 3. Extract handshake and application data packets
		const handshakePackets = bundleData.kOutputPayload.packets
		const applicationDataPackets = extractApplicationDataPackets(bundleData.tOutputPayload, isTLS12AESGCM)

		logger.info('TLS transcript reconstruction completed successfully')

		return {
			handshakePackets,
			applicationDataPackets,
			revealedRequest,
			reconstructedResponsePackets: responseData.individualPackets, // New: individual packets
			cipherSuite,
			tlsVersion: determineTlsVersion(cipherSuite)
		}

	} catch(error) {
		logger.error({ error }, 'TLS transcript reconstruction failed')
		throw new AttestorError('ERROR_INVALID_CLAIM', `Transcript reconstruction failed: ${(error as Error).message}`)
	}
}

/**
 * Reconstructs the original request by applying proof stream to redacted request
 */
function reconstructRequest(bundleData: TeeBundleData, logger: Logger): Uint8Array {
	const { kOutputPayload, opening } = bundleData

	if(!opening?.proofStream) {
		logger.warn('No proof stream available - using redacted request as-is')
		return kOutputPayload.redactedRequest
	}

	if(!kOutputPayload.requestRedactionRanges || kOutputPayload.requestRedactionRanges.length === 0) {
		logger.warn('No request redaction ranges - using redacted request as-is')
		return kOutputPayload.redactedRequest
	}

	// Create a copy of the redacted request
	const revealedRequest = new Uint8Array(kOutputPayload.redactedRequest)
	const proofStream = opening.proofStream

	// Apply proof stream ONLY to sensitive_proof ranges (XOR operation)
	let proofStreamOffset = 0
	let proofRangesFound = 0

	for(const range of kOutputPayload.requestRedactionRanges) {
		// Only reveal ranges marked as proof-relevant (sensitive_proof)
		if(range.type === 'sensitive_proof') {
			const start = range.start
			const length = range.length

			// Validate range bounds
			if(start + length > revealedRequest.length) {
				throw new Error(`Proof range [${start}:${start + length}] exceeds request length ${revealedRequest.length}`)
			}

			// Check if we have enough proof stream data
			if(proofStreamOffset + length > proofStream.length) {
				throw new Error(`Insufficient proof stream data for range ${proofRangesFound} (need ${length} bytes, have ${proofStream.length - proofStreamOffset})`)
			}

			// Apply XOR to reveal original sensitive_proof data
			for(let i = 0; i < length; i++) {
				revealedRequest[start + i] ^= proofStream[proofStreamOffset + i]
			}

			logger.debug(`Revealed proof range [${start}:${start + length}] type=${range.type} (${length} bytes)`)

			proofStreamOffset += length
			proofRangesFound++
		}
	}

	if(proofRangesFound === 0) {
		logger.warn('No proof ranges found to reveal')
	}

	logger.debug(`Applied proof stream to ${proofRangesFound} redaction ranges, used ${proofStreamOffset} bytes of proof stream`)

	// Create pretty display: show revealed proof data, but keep other sensitive data as '*'
	const prettyRequest = new Uint8Array(revealedRequest)

	for(const range of kOutputPayload.requestRedactionRanges) {
		// Keep non-proof sensitive data as '*' for display
		if(!range.type.includes('proof')) {
			const start = range.start
			const length = range.length

			for(let i = 0; i < length && start + i < prettyRequest.length; i++) {
				prettyRequest[start + i] = 0x2A // ASCII asterisk '*'
			}
		}
	}

	logger.debug(`Successfully revealed ${proofRangesFound} proof ranges while keeping sensitive data hidden`)

	return prettyRequest
}

/**
 * Reconstructs response by applying redacted streams to encrypted application data
 * Returns individual packets to preserve packet boundaries
 */
function reconstructResponse(bundleData: TeeBundleData, isTLS12AESGCM: boolean, logger: Logger): {
	individualPackets: Uint8Array[]
} {
	const { kOutputPayload, tOutputPayload } = bundleData

	if(!kOutputPayload.redactedStreams || kOutputPayload.redactedStreams.length === 0) {
		logger.warn('No redacted streams available for response reconstruction')
		return { individualPackets: [] }
	}

	// Extract ciphertexts from TEE_T application data packets
	const ciphertexts = extractCiphertexts(tOutputPayload, isTLS12AESGCM)

	// Reconstruct plaintext by walking streams and finding the next ciphertext with matching length
	const reconstructedPackets: Uint8Array[] = []
	let cipherIdx = 0

	if(kOutputPayload.redactedStreams.length > 0) {
		for(const stream of kOutputPayload.redactedStreams) {
			// Skip empty streams (happens in some protocol versions)
			if(stream.redactedStream.length === 0) {
				logger.debug(`Skipping empty redacted stream for seq ${stream.seqNum}`)
				continue
			}

			// Advance cipherIdx until length matches
			while(cipherIdx < ciphertexts.length && ciphertexts[cipherIdx].length !== stream.redactedStream.length) {
				cipherIdx++
			}

			if(cipherIdx >= ciphertexts.length) {
				logger.warn(`No ciphertext of length ${stream.redactedStream.length} found for stream seq ${stream.seqNum}`)
				logger.warn(`Available cipher lengths: ${ciphertexts.slice(cipherIdx, cipherIdx + 5).map(c => c.length).join(', ')}`)
				continue // Skip this stream instead of failing
			}

			const cipher = ciphertexts[cipherIdx]
			const plain = new Uint8Array(cipher.length)

			// XOR ciphertext with redacted stream to get plaintext
			for(const [i, cipherByte] of cipher.entries()) {
				plain[i] = cipherByte ^ stream.redactedStream[i]
			}

			reconstructedPackets.push(plain)
			cipherIdx++
		}
	}

	// Combine all reconstructed parts to apply redaction ranges correctly
	const totalLength = reconstructedPackets.reduce((sum, part) => sum + part.length, 0)
	const combinedResult = new Uint8Array(totalLength)
	let offset = 0

	for(const part of reconstructedPackets) {
		combinedResult.set(part, offset)
		offset += part.length
	}

	// Apply response redaction ranges to the COMBINED response (this is critical!)
	const redactedCombined = applyResponseRedactionRanges(combinedResult, kOutputPayload.responseRedactionRanges)

	// Now split the redacted combined response back into individual packets
	const redactedPackets: Uint8Array[] = []
	let currentOffset = 0

	for(const originalPacket of reconstructedPackets) {
		const packetLength = originalPacket.length
		const redactedPacket = redactedCombined.slice(currentOffset, currentOffset + packetLength)
		redactedPackets.push(redactedPacket)
		currentOffset += packetLength
	}

	logger.debug(`Reconstructed ${redactedPackets.length} individual response packets from ${kOutputPayload.redactedStreams.length} streams`)

	return { individualPackets: redactedPackets }
}

/**
 * Extracts application data ciphertexts from TEE_T packets
 */
function extractCiphertexts(tOutputPayload: TOutputPayload, isTLS12AESGCM: boolean): Uint8Array[] {
	const ciphertexts: Uint8Array[] = []

	for(const pkt of tOutputPayload.packets) {
		if(pkt.length < 5 + 16) { // Minimum TLS record size
			continue
		}

		// Skip non-ApplicationData packets, but allow Alert packets (0x15) for completeness
		if(pkt[0] !== 0x17 && pkt[0] !== 0x15) {
			continue
		}

		let ctLen: number
		let startOffset: number

		if(isTLS12AESGCM) {
			// TLS 1.2 AES-GCM: Header(5) + ExplicitIV(8) + EncryptedData + Tag(16)
			ctLen = pkt.length - 5 - 8 - 16 // Skip explicit IV and tag
			startOffset = 5 + 8 // Skip header and explicit IV
		} else {
			// TLS 1.3: Header(5) + EncryptedData + Tag(16)
			ctLen = pkt.length - 5 - 16 // Skip header and tag
			startOffset = 5 // Skip header only
		}

		if(ctLen <= 0) {
			continue
		}

		ciphertexts.push(pkt.slice(startOffset, startOffset + ctLen))
	}

	return ciphertexts
}

/**
 * Extracts application data packets from TEE_T output
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractApplicationDataPackets(tOutputPayload: TOutputPayload, _isTLS12AESGCM: boolean): Uint8Array[] {
	return tOutputPayload.packets.filter(pkt => {
		// Only include ApplicationData packets (0x17)
		return pkt.length >= 5 && pkt[0] === 0x17
	})
}

/**
 * Applies response redaction ranges to replace random garbage with asterisks
 * Response redaction ranges have NO type field - they all work the same way (binary redaction)
 */
function applyResponseRedactionRanges(
	response: Uint8Array,
	redactionRanges?: Array<{ start: number, length: number }>
): Uint8Array {
	if(!redactionRanges || redactionRanges.length === 0) {
		return response
	}

	const result = new Uint8Array(response)

	// Consolidate overlapping ranges (same as client implementation)
	const consolidatedRanges = consolidateRedactionRanges(redactionRanges)

	// Apply each redaction range to replace random garbage with asterisks
	for(const range of consolidatedRanges) {
		const rangeStart = range.start
		const rangeEnd = range.start + range.length

		// Check bounds
		if(rangeStart < 0 || rangeEnd > result.length) {
			continue // Skip invalid ranges
		}

		// Replace random garbage with asterisks
		for(let i = rangeStart; i < rangeEnd; i++) {
			result[i] = 0x2A // ASCII asterisk '*'
		}
	}

	return result
}

/**
 * Consolidates overlapping redaction ranges
 */
function consolidateRedactionRanges(
	ranges: Array<{ start: number, length: number }>
): Array<{ start: number, length: number }> {
	if(ranges.length === 0) {
		return []
	}

	// Sort ranges by start position
	const sortedRanges = [...ranges].sort((a, b) => a.start - b.start)
	const consolidated: Array<{ start: number, length: number }> = []

	let current = { ...sortedRanges[0] }

	for(let i = 1; i < sortedRanges.length; i++) {
		const next = sortedRanges[i]

		// Check if ranges overlap or are adjacent
		if(next.start <= current.start + current.length) {
			// Merge ranges
			const endCurrent = current.start + current.length
			const endNext = next.start + next.length
			current.length = Math.max(endCurrent, endNext) - current.start
		} else {
			// No overlap, add current and move to next
			consolidated.push(current)
			current = { ...next }
		}
	}

	consolidated.push(current)
	return consolidated
}

/**
 * Creates synthetic ClaimTunnelRequest from reconstructed transcript
 */
export function createSyntheticClaimRequest(
	transcriptData: TeeTranscriptData,
	claimData: any,
	bundleData: TeeBundleData,
	originalRequestSignature?: Uint8Array
): ClaimTunnelRequest {
	const messages: SyntheticTranscriptMessage[] = []

	// Add handshake packets
	for(const packet of transcriptData.handshakePackets) {
		messages.push({
			sender: determinePacketSender(packet),
			message: packet
			// No reveal needed for handshake packets
		})
	}

	// Add client request (revealed)
	messages.push({
		sender: 'client',
		message: wrapInTlsRecord(transcriptData.revealedRequest, 0x17),
		reveal: createTeeStreamReveal(transcriptData.revealedRequest, bundleData)
	})

	// Convert to the format expected by ClaimTunnelRequest
	const transcript = messages.map(msg => ({
		sender: msg.sender === 'client'
			? TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
			: TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER,
		message: msg.message,
		reveal: msg.reveal
	}))

	return {
		request: {
			id: 0, // Synthetic tunnel ID
			host: extractHostFromBundle(bundleData),
			port: 443, // Default HTTPS port
			geoLocation: ''
		},
		data: claimData,
		transcript,
		signatures: {
			requestSignature: originalRequestSignature || new Uint8Array()
		},
		zkEngine: 0, // Not applicable for TEE mode
		fixedServerIV: new Uint8Array(),
		fixedClientIV: new Uint8Array()
	}
}

/**
 * Helper functions
 */

function isTLS12AESGCMCipherSuite(cipherSuite: number): boolean {
	// Common TLS 1.2 AES-GCM cipher suites
	const tls12AesGcmSuites = [
		0x009C, // TLS_RSA_WITH_AES_128_GCM_SHA256
		0x009D, // TLS_RSA_WITH_AES_256_GCM_SHA384
		0x009E, // TLS_DHE_RSA_WITH_AES_128_GCM_SHA256
		0x009F, // TLS_DHE_RSA_WITH_AES_256_GCM_SHA384
		0xC02F, // TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
		0xC030, // TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
		0xC02B, // TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
		0xC02C // TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
	]

	return tls12AesGcmSuites.includes(cipherSuite)
}

function determineTlsVersion(cipherSuite?: number): string {
	if(!cipherSuite) {
		return 'unknown'
	}

	// TLS 1.3 cipher suites
	if(cipherSuite >= 0x1301 && cipherSuite <= 0x1305) {
		return 'TLS1_3'
	}

	// Assume TLS 1.2 for other suites
	return 'TLS1_2'
}

function determinePacketSender(packet: Uint8Array): 'client' | 'server' {
	// Simple heuristic based on TLS record type
	// ClientHello = 0x01, ServerHello = 0x02
	if(packet.length >= 6) {
		const handshakeType = packet[5]
		return handshakeType === 0x01 ? 'client' : 'server'
	}

	return 'server' // Default assumption
}

function wrapInTlsRecord(data: Uint8Array, recordType: number): Uint8Array {
	// Create TLS record: Type(1) + Version(2) + Length(2) + Data
	const record = new Uint8Array(5 + data.length)
	record[0] = recordType // Record type
	record[1] = 0x03 // TLS version major
	record[2] = 0x03 // TLS version minor (TLS 1.2)
	record[3] = (data.length >> 8) & 0xFF // Length high byte
	record[4] = data.length & 0xFF // Length low byte
	record.set(data, 5)
	return record
}

function createTeeStreamReveal(data: Uint8Array, bundleData: TeeBundleData): any {
	return {
		teeStreamReveal: {
			revealedData: data,
			teeSignature: bundleData.teekSigned?.signature || new Uint8Array(),
			teePublicKey: bundleData.teekSigned?.publicKey || new Uint8Array()
		}
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractHostFromBundle(_bundleData: TeeBundleData): string {
	// Try to extract hostname from SNI in handshake packets
	// This is a simplified implementation - in practice you'd parse TLS handshake
	return 'example.com' // Placeholder
}
