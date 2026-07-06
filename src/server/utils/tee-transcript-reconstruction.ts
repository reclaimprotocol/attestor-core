/**
 * TLS Transcript Reconstruction from TEE data
 */

import type { CertificateInfo } from '#src/proto/tee-bundle.ts'
import type { TeeBundleData } from '#src/server/utils/tee-verification.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'
import { makeHttpResponseParser, REDACTION_CHAR_CODE, strToUint8Array, uint8ArrayToStr } from '#src/utils/index.ts'

// Types specific to transcript reconstruction
export interface TeeTranscriptData {
	revealedRequest: Uint8Array
	reconstructedResponse: Uint8Array
	certificateInfo?: CertificateInfo
	responseTrimOffset?: number // Number of leading asterisks trimmed from response
}

/**
 * Reconstructs TLS transcript from TEE bundle data
 * @param bundleData - Validated TEE bundle data
 * @param logger - Logger instance
 * @param oprfResults - Optional OPRF results to apply during reconstruction
 * @returns Reconstructed transcript data
 */
export async function reconstructTlsTranscript(
	bundleData: TeeBundleData,
	logger: Logger,
	oprfResults?: Array<{ position: number, length: number, output: Uint8Array }>
): Promise<TeeTranscriptData> {
	try {

		// 1. Reconstruct request using proof stream
		const revealedRequest = reconstructRequest(bundleData, logger)

		// 2. Reconstruct response using consolidated keystream and ciphertext
		const reconstructedResponse = await reconstructConsolidatedResponse(bundleData, logger, oprfResults)

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
async function reconstructConsolidatedResponse(bundleData: TeeBundleData, logger: Logger, oprfResults?: Array<{
	position: number
	length: number
	output: Uint8Array
}>): Promise<Uint8Array> {
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

	logger.info(`Reconstructed response: ${reconstructedResponse.length} bytes, ${kOutputPayload.responseRedactionRanges?.length || 0} redaction ranges`)

	// Apply response redaction ranges to the reconstructed response
	let processedResponse = applyResponseRedactionRanges(reconstructedResponse, kOutputPayload.responseRedactionRanges, logger)

	// Trim leading (NewSessionTicket) and trailing (close_notify/alert) asterisks
	// BEFORE OPRF/dechunk so downstream positions are stable.
	let leadingAsterisks = 0
	for(const element of processedResponse) {
		if(element === REDACTION_CHAR_CODE) {
			leadingAsterisks++
		} else {
			break
		}
	}

	let trailingAsterisks = 0
	for(let i = processedResponse.length - 1; i >= leadingAsterisks; i--) {
		if(processedResponse[i] === REDACTION_CHAR_CODE) {
			trailingAsterisks++
		} else {
			break
		}
	}

	processedResponse = processedResponse.slice(leadingAsterisks, processedResponse.length - trailingAsterisks)

	// OPRF positions are in pre-trim coords; shift them into trimmed coords.
	let oprf = oprfResults?.map(r => ({ ...r, position: r.position - leadingAsterisks }))

	// TEE flow, new clients: chunk framing is revealed, so dechunk the body HERE —
	// BEFORE the length-changing OPRF replacement. If we replaced first, the inserted
	// hashes (longer than the matched bytes) would shift every subsequent chunk-size
	// offset and the verifier's dechunk would desync ("got more data after response
	// was complete"). Non-TEE / legacy flows leave framing in place and dechunk inside
	// the http provider using the same parser.
	const dechunked = dechunkRevealedResponse(processedResponse, oprf, logger)
	processedResponse = dechunked.response
	oprf = dechunked.oprfResults

	// Apply OPRF replacements on the now-contiguous body (length growth is harmless).
	if(oprf && oprf.length > 0) {
		logger.info(`Applying ${oprf.length} OPRF replacements`)
		const { replaceOprfRanges } = await import('#src/server/utils/tee-oprf-verification.ts')
		processedResponse = replaceOprfRanges(processedResponse, oprf, logger)
	}

	logger.info(`After processing: ${processedResponse.length} bytes (${leadingAsterisks} leading, ${trailingAsterisks} trailing asterisks trimmed)`)
	return processedResponse
}

// Synthetic header the http provider prepends when dechunking a revealed body.
const DECHUNK_SYNTH_HEADER = 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'

/**
 * TEE flow only: when chunk framing is revealed (new clients), dechunk the response
 * body up-front and remap OPRF positions into the dechunked body, so the subsequent
 * length-changing OPRF replacement can't desync chunk-size offsets. The
 * `transfer-encoding: chunked` token is blanked so the http provider does not dechunk
 * a second time. Returns the input unchanged when framing isn't revealed (legacy) or
 * the response isn't chunked — those are dechunked inside the provider instead.
 */
function dechunkRevealedResponse(
	response: Uint8Array,
	oprfResults: Array<{ position: number, length: number, output: Uint8Array }> | undefined,
	logger: Logger
): { response: Uint8Array, oprfResults?: Array<{ position: number, length: number, output: Uint8Array }> } {
	const headerEnd = findHeaderEnd(response)
	if(headerEnd < 0) {
		return { response, oprfResults }
	}

	const bodyStart = headerEnd + 4
	const headersStr = uint8ArrayToStr(response.slice(0, headerEnd))
	if(!/transfer-encoding:\s*chunked/i.test(headersStr)) {
		return { response, oprfResults }
	}

	// Dechunk via the same synthetic-header parse the http provider uses, so chunk
	// detection is identical. res.chunks positions are offset by the synthetic prefix.
	const parser = makeHttpResponseParser()
	parser.onChunk(strToUint8Array(DECHUNK_SYNTH_HEADER))
	parser.onChunk(response.slice(bodyStart))
	const chunks = parser.res.chunks
	if(!chunks || chunks.length === 0) {
		return { response, oprfResults }
	}

	const dechunkedBody = parser.res.body ?? new Uint8Array()

	// Blank the transfer-encoding token so the provider's dechunk is skipped.
	const headerRegion = response.slice(0, bodyStart)
	const teMatch = /transfer-encoding:\s*chunked/i.exec(uint8ArrayToStr(headerRegion))
	if(teMatch) {
		for(let i = teMatch.index; i < teMatch.index + teMatch[0].length; i++) {
			headerRegion[i] = 0x78 // 'x'
		}
	}

	const dechunkedResponse = new Uint8Array(headerRegion.length + dechunkedBody.length)
	dechunkedResponse.set(headerRegion, 0)
	dechunkedResponse.set(dechunkedBody, headerRegion.length)

	const synthLen = DECHUNK_SYNTH_HEADER.length
	const remapped = oprfResults?.map(r => ({
		...r,
		position: chunkedToDechunkedPos(r.position, bodyStart, synthLen, chunks)
	}))

	logger.info(`TEE dechunk before OPRF: ${response.length} -> ${dechunkedResponse.length} bytes, ${chunks.length} chunks`)
	return { response: dechunkedResponse, oprfResults: remapped }
}

// Index of the "\r\n\r\n" header/body separator, or -1.
function findHeaderEnd(response: Uint8Array): number {
	for(let i = 0; i + 3 < response.length; i++) {
		if(response[i] === 0x0d && response[i + 1] === 0x0a
			&& response[i + 2] === 0x0d && response[i + 3] === 0x0a) {
			return i
		}
	}

	return -1
}

// Map a position in the original (chunked) response to its position in the dechunked
// response. `chunks` are in synthetic-prefixed coords (fromIndex/toIndex point to chunk
// DATA), so subtract `synthLen` to get body-relative offsets.
function chunkedToDechunkedPos(
	pos: number,
	bodyStart: number,
	synthLen: number,
	chunks: Array<{ fromIndex: number, toIndex: number }>
): number {
	if(pos < bodyStart) {
		return pos
	}

	const bodyOff = pos - bodyStart
	let acc = 0
	for(const c of chunks) {
		const cf = c.fromIndex - synthLen
		const ct = c.toIndex - synthLen
		if(bodyOff >= cf && bodyOff < ct) {
			return bodyStart + acc + (bodyOff - cf)
		}

		if(bodyOff === ct) {
			return bodyStart + acc + (ct - cf)
		}

		acc += ct - cf
	}

	return bodyStart + acc
}

// Removed legacy packet-based extraction functions since we now use consolidated streams

/**
 * Applies response redaction ranges to replace random garbage with asterisks
 * Response redaction ranges have NO type field - they all work the same way (binary redaction)
 */
function applyResponseRedactionRanges(
	response: Uint8Array,
	redactionRanges?: Array<{ start: number, length: number }>,
	logger?: Logger
): Uint8Array {
	if(!redactionRanges || redactionRanges.length === 0) {
		return response
	}

	const result = new Uint8Array(response)

	// Consolidate overlapping ranges (same as client implementation)
	const consolidatedRanges = consolidateRedactionRanges(redactionRanges)

	if(logger) {
		logger.info(`Applying ${consolidatedRanges.length} redaction ranges to ${response.length} byte response`)
	}

	// Apply each redaction range to replace random garbage with asterisks
	for(const [idx, range] of consolidatedRanges.entries()) {
		const rangeStart = range.start
		const rangeEnd = range.start + range.length

		// Check bounds
		if(rangeStart < 0 || rangeEnd > result.length) {
			if(logger) {
				logger.warn(`Redaction range #${idx} out of bounds: [${rangeStart}-${rangeEnd}] vs ${result.length}`)
			}

			continue
		}

		if(logger && idx < 3) {
			logger.info(`Redaction range #${idx}: [${rangeStart}-${rangeEnd}]`)
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