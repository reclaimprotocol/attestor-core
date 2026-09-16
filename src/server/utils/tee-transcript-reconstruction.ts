/**
 * TLS Transcript Reconstruction from TEE data
 */

import type { CertificateInfo } from '#src/proto/tee-bundle.ts'
import { detectResponseCharset } from '#src/providers/http/response-charset.ts'
import type { TeeBundleData } from '#src/server/utils/tee-verification.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'
import { makeHttpResponseParser, REDACTION_CHAR_CODE, strToUint8Array, uint8ArrayToStr } from '#src/utils/index.ts'

// Types specific to transcript reconstruction
export interface TeeTranscriptData {
	revealedRequest: Uint8Array
	reconstructedResponse: Uint8Array
	certificateInfo?: CertificateInfo
	authenticatedResponseCharset?: string
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
		const { response: reconstructedResponse, authenticatedResponseCharset } = await reconstructConsolidatedResponse(bundleData, logger, oprfResults)

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
			certificateInfo,
			authenticatedResponseCharset
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
	const { kOutputPayload, protocolMode } = bundleData
	const cbcContract = kOutputPayload.tls12Cbc
	const redactedRequest = protocolMode === 'tls12-cbc'
		? cbcContract!.authenticatedRedactedRequest
		: kOutputPayload.redactedRequest
	const requestRedactionRanges = protocolMode === 'tls12-cbc'
		? cbcContract!.requestRedactionRanges
		: kOutputPayload.requestRedactionRanges

	if(requestRedactionRanges.length === 0) {
		logger.warn('No request redaction ranges - using redacted request as-is')
		return redactedRequest
	}

	// Create a copy of the redacted request
	const revealedRequest = new Uint8Array(redactedRequest)

	// Create pretty display: show revealed proof data, but keep other sensitive data as '*'
	const prettyRequest = new Uint8Array(revealedRequest)

	for(const range of requestRedactionRanges) {
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
}>): Promise<{ response: Uint8Array, authenticatedResponseCharset?: string }> {
	const { kOutputPayload, tOutputPayload, protocolMode } = bundleData
	const isTls12Cbc = protocolMode === 'tls12-cbc'
	let reconstructedResponse: Uint8Array
	let responseRedactionRanges: Array<{ start: number, length: number }>

	if(isTls12Cbc) {
		reconstructedResponse = new Uint8Array(tOutputPayload.tls12Cbc!.authenticatedRedactedResponse)
		responseRedactionRanges = tOutputPayload.tls12Cbc!.responseRedactionRanges
	} else {
		const consolidatedKeystream = kOutputPayload.consolidatedResponseKeystream
		const consolidatedCiphertext = tOutputPayload.consolidatedResponseCiphertext

		if(consolidatedKeystream.length === 0) {
			throw new AttestorError('ERROR_INVALID_CLAIM', 'No consolidated response keystream available')
		}

		if(consolidatedCiphertext.length === 0) {
			throw new AttestorError('ERROR_INVALID_CLAIM', 'No consolidated response ciphertext available')
		}

		if(consolidatedKeystream.length !== consolidatedCiphertext.length) {
			logger.warn('Keystream and ciphertext length mismatch', {
				keystreamLength: consolidatedKeystream.length,
				ciphertextLength: consolidatedCiphertext.length
			})
		}

		const minLength = Math.min(consolidatedKeystream.length, consolidatedCiphertext.length)
		reconstructedResponse = new Uint8Array(minLength)
		for(let i = 0; i < minLength; i++) {
			reconstructedResponse[i] = consolidatedKeystream[i] ^ consolidatedCiphertext[i]
		}
		responseRedactionRanges = kOutputPayload.responseRedactionRanges
	}

	// A truncated XOR transcript cannot establish absence of later declarations.
	const completeShares = isTls12Cbc || kOutputPayload.consolidatedResponseKeystream.length === tOutputPayload.consolidatedResponseCiphertext.length
	const authenticatedResponseCharset = completeShares
		? charsetFromAuthenticatedPrefix(reconstructedResponse, responseRedactionRanges, oprfResults, isTls12Cbc) : undefined

	logger.info(`Reconstructed response: ${reconstructedResponse.length} bytes, ${responseRedactionRanges.length} redaction ranges`)

	// CBC carries authenticated redacted plaintext directly. Split AEAD first
	// reconstructs plaintext by XOR. Both modes then use their signed ranges.
	let processedResponse = applyResponseRedactionRanges(reconstructedResponse, responseRedactionRanges, logger)

	// Trim leading (NewSessionTicket) and trailing (close_notify/alert) asterisks
	// BEFORE OPRF/dechunk so downstream positions are stable.
	let leadingAsterisks = 0
	let trailingAsterisks = 0
	if(!isTls12Cbc) {
		for(const element of processedResponse) {
			if(element === REDACTION_CHAR_CODE) {
				leadingAsterisks++
			} else {
				break
			}
		}

		for(let i = processedResponse.length - 1; i >= leadingAsterisks; i--) {
			if(processedResponse[i] === REDACTION_CHAR_CODE) {
				trailingAsterisks++
			} else {
				break
			}
		}

		processedResponse = processedResponse.slice(leadingAsterisks, processedResponse.length - trailingAsterisks)
	}

	// OPRF positions are in pre-trim coords; shift them into trimmed coords.
	let oprf = oprfResults?.map(r => ({ ...r, position: r.position - leadingAsterisks }))

	// TEE flow, new clients: chunk framing is revealed, so dechunk the body HERE —
	// BEFORE the length-changing OPRF replacement. If we replaced first, the inserted
	// hashes (longer than the matched bytes) would shift every subsequent chunk-size
	// offset and the verifier's dechunk would desync ("got more data after response
	// was complete"). Non-TEE / legacy flows leave framing in place and dechunk inside
	// the http provider using the same parser.
	const dechunked = dechunkRevealedResponse(processedResponse, oprf, logger, isTls12Cbc)
	processedResponse = dechunked.response
	oprf = dechunked.oprfResults

	// Apply OPRF replacements on the now-contiguous body (length growth is harmless).
	if(oprf && oprf.length > 0) {
		logger.info(`Applying ${oprf.length} OPRF replacements`)
		const { replaceOprfRanges } = await import('#src/server/utils/tee-oprf-verification.ts')
		processedResponse = replaceOprfRanges(processedResponse, oprf, logger)
	}

	logger.info(`After processing: ${processedResponse.length} bytes (${leadingAsterisks} leading, ${trailingAsterisks} trailing asterisks trimmed)`)
	return { response: processedResponse, authenticatedResponseCharset }
}

const CHUNKED_ENCODING = /transfer-encoding:\s*chunked/i
// Synthetic header the legacy parser uses when dechunking a revealed body.
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
	logger: Logger,
	strictOprfRanges: boolean,
): { response: Uint8Array, oprfResults?: Array<{ position: number, length: number, output: Uint8Array }> } {
	const headerEnd = findHeaderEnd(response)
	if(headerEnd < 0) {
		return { response, oprfResults }
	}

	const bodyStart = headerEnd + 4
	const headersStr = uint8ArrayToStr(response.slice(0, headerEnd))
	if(!CHUNKED_ENCODING.test(headersStr)) {
		return { response, oprfResults }
	}

	const parsed = parseReconstructionChunks(response, bodyStart, strictOprfRanges)
	if(!parsed) { return { response, oprfResults } }
	const dechunkedBody = parsed.body
	const chunkCount = parsed.chunks.length
	const remapped = oprfResults?.map(r => strictOprfRanges
		? remapCbcChunkedOprfRange(r, bodyStart, parsed.chunks)
		: { ...r, position: chunkedToDechunkedPos(r.position, bodyStart, bodyStart, parsed.chunks) })

	// Blank the transfer-encoding token so the provider's dechunk is skipped.
	const headerRegion = response.slice(0, bodyStart)
	const teMatch = CHUNKED_ENCODING.exec(uint8ArrayToStr(headerRegion))
	if(teMatch) {
		for(let i = teMatch.index; i < teMatch.index + teMatch[0].length; i++) {
			headerRegion[i] = 0x78 // 'x'
		}
	}

	const dechunkedResponse = new Uint8Array(headerRegion.length + dechunkedBody.length)
	dechunkedResponse.set(headerRegion, 0)
	dechunkedResponse.set(dechunkedBody, headerRegion.length)

	logger.info(`TEE dechunk before OPRF: ${response.length} -> ${dechunkedResponse.length} bytes, ${chunkCount} chunks`)
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
function remapCbcChunkedOprfRange(
	range: { position: number, length: number, output: Uint8Array },
	bodyStart: number,
	chunks: Array<{ fromIndex: number, toIndex: number }>
): { position: number, length: number, output: Uint8Array } {
	const rangeEnd = range.position + range.length
	if(range.position < bodyStart) {
		if(rangeEnd > bodyStart) {
			throw new AttestorError('ERROR_INVALID_CLAIM', 'OPRF range crosses the HTTP header boundary')
		}
		return range
	}

	let acc = 0
	for(const c of chunks) {
		if(range.position >= c.fromIndex && rangeEnd <= c.toIndex) {
			return {
				...range,
				position: bodyStart + acc + (range.position - c.fromIndex),
			}
		}

		acc += c.toIndex - c.fromIndex
	}

	throw new AttestorError(
		'ERROR_INVALID_CLAIM',
		`OPRF range [${range.position}:${rangeEnd}] is not wholly contained in HTTP chunk data`
	)
}

// Shared by charset evidence and response reconstruction. All chunk ranges
// use original signed response offsets, even when the legacy parser needs a
// canonical synthetic header to recognize valid casing/whitespace variants.
function parseReconstructionChunks(response: Uint8Array, bodyStart: number, strict: boolean) {
	if(strict) { return dechunkCompleteCbcBody(response, bodyStart) }
	const parser = makeHttpResponseParser()
	parser.onChunk(strToUint8Array(DECHUNK_SYNTH_HEADER))
	parser.onChunk(response.slice(bodyStart))
	if(!parser.res.chunks?.length) { return undefined }
	return {
		body: parser.res.body ?? new Uint8Array(),
		chunks: parser.res.chunks.map(chunk => ({
			fromIndex: chunk.fromIndex + bodyStart - DECHUNK_SYNTH_HEADER.length,
			toIndex: chunk.toIndex + bodyStart - DECHUNK_SYNTH_HEADER.length,
		})),
	}
}

function dechunkCompleteCbcBody(
	response: Uint8Array,
	bodyStart: number,
): { body: Uint8Array, chunks: Array<{ fromIndex: number, toIndex: number }> } {
	const bodyParts: Uint8Array[] = []
	const chunks: Array<{ fromIndex: number, toIndex: number }> = []
	let offset = bodyStart
	for(;;) {
		const lineEnd = findCrlf(response, offset)
		if(lineEnd < 0) {
			throw new AttestorError('ERROR_INVALID_CLAIM', 'CBC chunk size line is incomplete during reconstruction')
		}
		const sizeLine = uint8ArrayToStr(response.slice(offset, lineEnd))
		const extension = sizeLine.indexOf(';')
		const sizeText = (extension < 0 ? sizeLine : sizeLine.slice(0, extension)).trim()
		if(!/^[0-9a-fA-F]+$/.test(sizeText)) {
			throw new AttestorError('ERROR_INVALID_CLAIM', 'CBC chunk size is invalid during reconstruction')
		}
		const size = Number.parseInt(sizeText, 16)
		offset = lineEnd + 2

		if(size === 0) {
			for(;;) {
				const trailerEnd = findCrlf(response, offset)
				if(trailerEnd < 0) {
					throw new AttestorError('ERROR_INVALID_CLAIM', 'CBC chunk trailers are incomplete during reconstruction')
				}
				const trailerStart = offset
				offset = trailerEnd + 2
				if(trailerEnd === trailerStart) {
					if(offset !== response.length) {
						throw new AttestorError('ERROR_INVALID_CLAIM', 'CBC chunked response has trailing bytes during reconstruction')
					}
					return { body: concatenateParts(bodyParts), chunks }
				}
			}
		}

		const dataEnd = offset + size
		if(dataEnd + 2 > response.length || response[dataEnd] !== 13 || response[dataEnd + 1] !== 10) {
			throw new AttestorError('ERROR_INVALID_CLAIM', 'CBC chunk data is incomplete during reconstruction')
		}
		chunks.push({ fromIndex: offset, toIndex: dataEnd })
		bodyParts.push(response.slice(offset, dataEnd))
		offset = dataEnd + 2
	}
}

function findCrlf(response: Uint8Array, start: number): number {
	for(let index = start; index + 1 < response.length; index++) {
		if(response[index] === 13 && response[index + 1] === 10) {
			return index
		}
	}
	return -1
}

function concatenateParts(parts: Uint8Array[]): Uint8Array {
	const length = parts.reduce((total, part) => total + part.length, 0)
	const result = new Uint8Array(length)
	let offset = 0
	for(const part of parts) {
		result.set(part, offset)
		offset += part.length
	}
	return result
}

// Keep the pre-CBC position mapping byte-for-byte equivalent. Legacy bundles
// historically allowed positions at chunk boundaries and beyond the last
// parsed chunk; tightening those rules would reject previously valid claims.
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

/** Use only original bytes before the first signed redaction or replacement.
 * Called after TEE signature verification and before trimming/dechunking/OPRF.
 * No client-supplied charset or inspection of replacement asterisks is used.
 */
export function charsetFromAuthenticatedPrefix(
	response: Uint8Array,
	redactions: Array<{ start: number, length: number }>,
	replacements: Array<{ position: number, length: number }> = [],
	strictChunkFraming = false,
) {
	let publicEnd = response.length
	for(const { start, length } of redactions) {
		if(!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > response.length) { return undefined }
		if(length) { publicEnd = Math.min(publicEnd, start) }
	}
	for(const { position, length } of replacements) {
		if(!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > response.length) { return undefined }
		publicEnd = Math.min(publicEnd, position)
	}
	// Never infer a response start by trimming hidden bytes.
	if(!new TextDecoder().decode(response.subarray(0, Math.min(publicEnd, 9))).startsWith('HTTP/1.1 ')) { return undefined }
	try {
		const headerEnd = findHeaderEnd(response)
		const bodyStart = headerEnd + 4
		if(headerEnd < 0 || publicEnd < bodyStart) { return undefined }
		// Complete original headers establish absence/precedence of Content-Type.
		const headerText = new TextDecoder().decode(response.subarray(0, bodyStart))
		const headers = parseCharsetEvidenceHeaders(headerText)
		if(!headers) { return undefined }
		// Legacy reconstruction uses a permissive regex. A new override is
		// allowed only when that interpretation agrees with strict HTTP fields.
		if(CHUNKED_ENCODING.test(headerText) !== headers.chunked) { return undefined }
		let parsed: { body: Uint8Array, chunks?: Array<{ fromIndex: number, toIndex: number }> }
		if(headers.chunked) {
			parsed = dechunkCompleteCbcBody(response, bodyStart)
			const reconstructed = parseReconstructionChunks(response, bodyStart, strictChunkFraming)
			if(reconstructed?.body.length !== parsed.body.length || !parsed.body.every((byte, i) => byte === reconstructed.body[i])) { return undefined }
		} else {
			const body = response.subarray(bodyStart)
			if(headers.contentLength !== undefined && headers.contentLength !== body.length) { return undefined }
			parsed = { body }
		}
		let publicBodyLength = Math.min(parsed.body.length, publicEnd - bodyStart)
		if(parsed.chunks?.length) {
			publicBodyLength = 0
			for(const chunk of parsed.chunks) {
				if(chunk.fromIndex >= publicEnd) { break }
				publicBodyLength += Math.max(0, Math.min(chunk.toIndex, publicEnd) - chunk.fromIndex)
				if(chunk.toIndex >= publicEnd) { break }
			}
		}
		if(publicBodyLength < Math.min(3, parsed.body.length)) { return undefined }
		return detectResponseCharset(parsed.body.subarray(0, publicBodyLength), headers.contentType, publicEnd === response.length && publicBodyLength === parsed.body.length)
	} catch {
		// Incomplete framing/unsupported evidence keeps the established policy.
		return undefined
	}
}

// Conservative framing authorization for a new document-charset override.
// Unsupported/ambiguous HTTP syntax stays on the established legacy policy.
function parseCharsetEvidenceHeaders(text: string) {
	const lines = text.split('\r\n')
	if(!/^HTTP\/1\.1 [0-9]{3} [^\r\n]*$/.test(lines.shift() ?? '')) { return undefined }
	const fields = new Map<string, string[]>()
	for(const line of lines) {
		if(!line) { continue }
		const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line)
		if(!match) { return undefined }
		const key = match[1].toLowerCase()
		fields.set(key, [...(fields.get(key) ?? []), match[2].trim()])
	}
	const contentTypes = fields.get('content-type') ?? []
	if(contentTypes.length !== 1) { return undefined }
	const encodings = fields.get('content-encoding') ?? []
	if(encodings.length && (encodings.length !== 1 || encodings[0].toLowerCase() !== 'identity')) { return undefined }
	const transfer = fields.get('transfer-encoding') ?? []
	if(transfer.length && (transfer.length !== 1 || transfer[0].toLowerCase() !== 'chunked')) { return undefined }
	const lengths = fields.get('content-length') ?? []
	if(lengths.length > 1 || (transfer.length && lengths.length)) { return undefined }
	if(lengths.length && !/^[0-9]+$/.test(lengths[0])) { return undefined }
	const contentLength = lengths.length ? Number(lengths[0]) : undefined
	if(contentLength !== undefined && !Number.isSafeInteger(contentLength)) { return undefined }
	return { contentType: contentTypes[0], chunked: !!transfer.length, contentLength }
}
