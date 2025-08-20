/**
 * TLS Transcript Reconstruction from TEE data
 */

import { ClaimTunnelRequest, TranscriptMessageSenderType } from 'src/proto/api'
import { Logger } from 'src/types'
import { SyntheticTranscriptMessage, TeeBundleData, TeeTranscriptData } from 'src/types/tee'
import { AttestorError, REDACTION_CHAR_CODE } from 'src/utils'

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
		// Extract cipher suite from certificate info if available
		const cipherSuite = undefined // cipher suite info now in bundleData.kOutputPayload.certificateInfo (if needed)

		// 1. Reconstruct request using proof stream
		const revealedRequest = reconstructRequest(bundleData, logger)

		// 2. Reconstruct response using consolidated keystream and ciphertext
		const reconstructedResponse = reconstructConsolidatedResponse(bundleData, logger)

		// 3. Extract certificate info from TEE_K payload
		const certificateInfo = bundleData.kOutputPayload.certificateInfo

		logger.info('TLS transcript reconstruction completed successfully', {
			requestSize: revealedRequest.length,
			responseSize: reconstructedResponse.length,
			hasCertificateInfo: !!certificateInfo
		})

		return {
			revealedRequest,
			reconstructedResponse,
			cipherSuite,
			tlsVersion: determineTlsVersion(cipherSuite),
			certificateInfo
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
	const { kOutputPayload } = bundleData

	if(!kOutputPayload.requestRedactionRanges || kOutputPayload.requestRedactionRanges.length === 0) {
		logger.warn('No request redaction ranges - using redacted request as-is')
		return kOutputPayload.redactedRequest
	}

	// Create a copy of the redacted request
	const revealedRequest = new Uint8Array(kOutputPayload.redactedRequest)

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

	return prettyRequest
}

/**
 * NEW: Reconstructs response using consolidated keystream and ciphertext
 * This is much simpler than the old packet-by-packet approach
 */
function reconstructConsolidatedResponse(bundleData: TeeBundleData, logger: Logger): Uint8Array {
	const { kOutputPayload, tOutputPayload } = bundleData

	// Get consolidated data from both TEEs
	const consolidatedKeystream = kOutputPayload.consolidatedResponseKeystream
	const consolidatedCiphertext = tOutputPayload.consolidatedResponseCiphertext

	if(!consolidatedKeystream || consolidatedKeystream.length === 0) {
		throw new AttestorError('ERROR_INVALID_CLAIM', 'No consolidated response keystream available')
	}

	if(!consolidatedCiphertext || consolidatedCiphertext.length === 0) {
		throw new AttestorError('ERROR_INVALID_CLAIM', 'No consolidated response ciphertext available')
	}

	// Verify lengths match
	if(consolidatedKeystream.length !== consolidatedCiphertext.length) {
		logger.warn('Keystream and ciphertext length mismatch', {
			keystreamLength: consolidatedKeystream.length,
			ciphertextLength: consolidatedCiphertext.length
		})
	}

	// XOR to get plaintext (keystream XOR ciphertext = plaintext)
	const minLength = Math.min(consolidatedKeystream.length, consolidatedCiphertext.length)
	const reconstructedResponse = new Uint8Array(minLength)

	for(let i = 0; i < minLength; i++) {
		reconstructedResponse[i] = consolidatedKeystream[i] ^ consolidatedCiphertext[i]
	}

	// Apply response redaction ranges to the reconstructed response
	const redactedResponse = applyResponseRedactionRanges(reconstructedResponse, kOutputPayload.responseRedactionRanges)
	let lastAsteriskIndex = -1
	for(const element of redactedResponse) {
		if(element === REDACTION_CHAR_CODE) {
			lastAsteriskIndex++
		} else {
			break
		}
	}

	return redactedResponse.slice(lastAsteriskIndex + 1)
}

// Removed legacy packet-based extraction functions since we now use consolidated streams

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

	// Note: Handshake packets are no longer provided separately in the new schema.
	// Certificate information is now structured in certificateInfo field.
	// For synthetic claims, we focus on the application data.

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

// Removed determinePacketSender function since handshake packets are no longer processed individually

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
			teePublicKey: bundleData.teekSigned?.ethAddress || new Uint8Array()
		}
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractHostFromBundle(_bundleData: TeeBundleData): string {
	// Extract hostname from certificate info or SNI data
	// This is a simplified implementation - in practice you'd use the certificateInfo
	return 'example.com' // Placeholder
}
