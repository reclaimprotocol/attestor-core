/**
 * TEE OPRF Verification and Replacement
 * Verifies OPRF proofs and replaces ranges in reconstructed plaintext
 */

import type { ZKProofPublicSignalsOPRF } from '@reclaimprotocol/zk-symmetric-crypto'
import bs58 from 'bs58'

import type { OPRFVerificationData } from '#src/proto/tee-bundle.ts'
import type { TeeBundleData } from '#src/server/utils/tee-verification.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'
import { makeDefaultOPRFOperator } from '#src/utils/zk.ts'

export interface OprfVerificationResult {
	position: number
	length: number
	output: Uint8Array // Base64-decoded OPRF output
	isMPC?: boolean // If true, keep full hash length (don't truncate)
}

/**
 * Verifies all OPRF proofs in the bundle and returns replacement data
 */
export async function verifyOprfProofs(
	bundleData: TeeBundleData & { oprfVerifications?: OPRFVerificationData[] },
	logger: Logger
): Promise<OprfVerificationResult[]> {
	if(!bundleData.oprfVerifications || bundleData.oprfVerifications.length === 0) {
		logger.debug('No OPRF verifications present in bundle')
		return []
	}

	const { tOutputPayload } = bundleData
	const consolidatedCiphertext = tOutputPayload.consolidatedResponseCiphertext

	if(!consolidatedCiphertext || consolidatedCiphertext.length === 0) {
		throw new AttestorError('ERROR_INVALID_CLAIM', 'No consolidated ciphertext for OPRF verification')
	}

	const results: OprfVerificationResult[] = []

	logger.info(`Verifying ${bundleData.oprfVerifications.length} OPRF proofs`)

	for(const [idx, oprfData] of bundleData.oprfVerifications.entries()) {
		try {
			const result = await verifySingleOprfProof(
				oprfData,
				consolidatedCiphertext,
				idx,
				logger
			)
			results.push(result)
		} catch(error) {
			logger.error({ error, index: idx }, 'OPRF proof verification failed')
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`OPRF verification failed at index ${idx}: ${(error as Error).message}`
			)
		}
	}

	logger.info(`Successfully verified ${results.length} OPRF proofs`)
	return results
}

/**
 * Verifies a single OPRF proof and extracts the output
 */
async function verifySingleOprfProof(
	oprfData: OPRFVerificationData,
	consolidatedCiphertext: Uint8Array,
	index: number,
	logger: Logger
): Promise<OprfVerificationResult> {
	// Parse public signals JSON
	const publicSignalsJson = JSON.parse(new TextDecoder().decode(oprfData.publicSignalsJson))
	const { proof, publicSignals, cipher } = publicSignalsJson

	if(!proof || !publicSignals) {
		throw new Error('Missing proof or public signals in OPRF data')
	}

	// Extract ciphertext chunk for verification
	const ciphertextChunk = consolidatedCiphertext.slice(
		oprfData.streamPos,
		oprfData.streamPos + oprfData.streamLength
	)

	// Build complete public signals for verification
	// Start with original signals and override specific fields
	const completePublicSignals: ZKProofPublicSignalsOPRF = {

		out: publicSignals.out || Uint8Array.from([]),
		// Replace null input with extracted ciphertext
		in: ciphertextChunk,
		// Convert base64 nonces and counters
		noncesAndCounters: publicSignals.blocks?.map((block: any) => ({
			nonce: Buffer.from(block.nonce || '', 'base64'),
			counter: block.counter || 0,
			boundary: block.boundary || '',
		})) || [],
		// Process TOPRF data
		toprf: publicSignals.toprf ? {
			...publicSignals.toprf,
			// Convert domain separator from base64
			domainSeparator: publicSignals.toprf.domainSeparator ?
				Buffer.from(publicSignals.toprf.domainSeparator, 'base64').toString('utf8') :
				'reclaim',
			// Convert output from base64
			output: publicSignals.toprf.output ?
				Buffer.from(publicSignals.toprf.output, 'base64') :
				new Uint8Array(),
			// Convert response fields from base64
			responses: publicSignals.toprf.responses?.map((resp: any) => ({
				publicKeyShare: Buffer.from(resp.publicKeyShare || '', 'base64'),
				evaluated: Buffer.from(resp.evaluated || '', 'base64'),
				c: Buffer.from(resp.c || '', 'base64'),
				r: Buffer.from(resp.r || '', 'base64')
			})) || [],
			// Locations are already in correct format
			locations: publicSignals.toprf.locations || []
		} : undefined
	}


	// Determine algorithm from cipher field
	// Remove '-toprf' suffix but keep the rest of the algorithm name
	const algorithm = cipher.replace('-toprf', '')

	const zkEngine = 'gnark' // Default to gnark for server-side verification

	// Get OPRF operator for verification
	const oprfOperator = makeDefaultOPRFOperator(algorithm, zkEngine, logger)

	// Convert proof from base64
	const proofBytes = Buffer.from(proof, 'base64')

	// Verify the proof
	const isValid = await oprfOperator.groth16Verify(
		completePublicSignals,
		proofBytes,
		logger
	)

	if(!isValid) {
		throw new Error('OPRF proof verification failed')
	}

	logger.debug(`OPRF ${index}: Proof verified successfully`)

	// Extract OPRF output for replacement
	const oprfOutput = completePublicSignals.toprf?.output
	if(!oprfOutput || oprfOutput.length === 0) {
		throw new Error('No OPRF output found in verified proof')
	}

	// Get the actual location within the stream where OPRF data resides
	const oprfLocation = completePublicSignals.toprf?.locations?.[0]
	if(!oprfLocation) {
		throw new Error('No OPRF location found in public signals')
	}

	// Log position calculation
	logger.info(`OPRF #${index}: streamPos=${oprfData.streamPos}, locationPos=${oprfLocation.pos}, finalPos=${oprfData.streamPos + oprfLocation.pos}, len=${oprfLocation.len}`)

	return {
		// The position in the plaintext where to replace (stream position + OPRF location within chunk)
		position: oprfData.streamPos + oprfLocation.pos,
		length: oprfLocation.len,
		output: oprfOutput as Uint8Array
	}
}

/**
 * Replaces OPRF ranges in the reconstructed plaintext with verified outputs.
 * Properly expands or contracts the transcript to fit replacement hashes.
 */
export function replaceOprfRanges(
	plaintext: Uint8Array,
	oprfResults: OprfVerificationResult[],
	logger: Logger
): Uint8Array {
	if(oprfResults.length === 0) {
		return plaintext
	}

	// Pre-compute replacement data for each result
	interface ReplacementData {
		result: OprfVerificationResult
		outputBytes: Uint8Array
		encodedOutput: string
	}
	const replacements: ReplacementData[] = oprfResults.map(result => {
		let outputBytes: Uint8Array
		let encodedOutput: string

		if(result.isMPC) {
			// MPC OPRF: use base58 encoding, full hash length (no truncation)
			encodedOutput = bs58.encode(result.output)
			outputBytes = new TextEncoder().encode(encodedOutput)
		} else {
			// TOPRF: use base64 encoding, truncate to fit original data length
			encodedOutput = Buffer.from(result.output).toString('base64')
			const truncated = encodedOutput.substring(0, result.length)
			outputBytes = new TextEncoder().encode(truncated)
		}

		return { result, outputBytes, encodedOutput }
	})

	// Sort by position (ascending) to process in order
	replacements.sort((a, b) => a.result.position - b.result.position)

	// Calculate new transcript size
	let newSize = plaintext.length
	for(const { result, outputBytes } of replacements) {
		const sizeDiff = outputBytes.length - result.length
		newSize += sizeDiff
	}

	logger.info(`Transcript size: ${plaintext.length} -> ${newSize} (${newSize - plaintext.length >= 0 ? '+' : ''}${newSize - plaintext.length} bytes)`)

	// Build new transcript by copying segments and inserting replacements
	const newPlaintext = new Uint8Array(newSize)
	let srcPos = 0 // Position in original plaintext
	let dstPos = 0 // Position in new plaintext

	for(const [idx, { result, outputBytes, encodedOutput }] of replacements.entries()) {
		// Copy segment before this replacement
		const segmentLength = result.position - srcPos
		if(segmentLength > 0) {
			newPlaintext.set(plaintext.slice(srcPos, result.position), dstPos)
			dstPos += segmentLength
		}

		// Log replacement
		const currentContent = plaintext.slice(result.position, result.position + result.length)
		logger.info(`OPRF #${idx} at pos ${result.position}: "${Buffer.from(currentContent).toString('utf8')}" (${result.length}b) -> "${encodedOutput}" (${outputBytes.length}b)${result.isMPC ? ' [MPC/base58]' : ''}`)

		// Insert replacement hash
		newPlaintext.set(outputBytes, dstPos)
		dstPos += outputBytes.length

		// Move source position past the replaced range
		srcPos = result.position + result.length
	}

	// Copy remaining segment after last replacement
	if(srcPos < plaintext.length) {
		newPlaintext.set(plaintext.slice(srcPos), dstPos)
	}

	logger.info(`Replaced ${oprfResults.length} OPRF ranges in plaintext`)
	return newPlaintext
}