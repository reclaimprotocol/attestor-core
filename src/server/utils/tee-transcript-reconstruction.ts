/**
 * TLS Transcript Reconstruction from TEE data
 */

import type { CertificateInfo } from '#src/proto/tee-bundle.ts'
import type { TeeBundleData } from '#src/server/utils/tee-verification.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'
import { REDACTION_CHAR_CODE } from '#src/utils/index.ts'

// Types specific to transcript reconstruction
export interface TeeTranscriptData {
	revealedRequest: Uint8Array
	reconstructedResponse: Uint8Array
	certificateInfo?: CertificateInfo
}

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
				prettyRequest[start + i] = REDACTION_CHAR_CODE
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
			result[i] = REDACTION_CHAR_CODE
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