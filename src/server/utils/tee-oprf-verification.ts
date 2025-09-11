/**
 * TEE OPRF Verification and Replacement
 * Verifies OPRF proofs and replaces ranges in reconstructed plaintext
 */

import type { ZKProofPublicSignalsOPRF } from '@reclaimprotocol/zk-symmetric-crypto'

import type { OPRFVerificationData } from '#src/proto/tee-bundle.ts'
import type { TeeBundleData } from '#src/server/utils/tee-verification.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'
import { makeDefaultOPRFOperator } from '#src/utils/zk.ts'

export interface OprfVerificationResult {
	position: number
	length: number
	output: Uint8Array // Base64-decoded OPRF output
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
 * Replaces OPRF ranges in the reconstructed plaintext with verified outputs
 */
export function replaceOprfRanges(
	plaintext: Uint8Array,
	oprfResults: OprfVerificationResult[],
	logger: Logger
): Uint8Array {
	if(oprfResults.length === 0) {
		return plaintext
	}

	// Create a copy to modify
	const modifiedPlaintext = new Uint8Array(plaintext)

	for(const [idx, result] of oprfResults.entries()) {
		// Convert OPRF output to base64 string then to bytes
		const base64Output = Buffer.from(result.output).toString('base64')
		const outputBytes = new TextEncoder().encode(base64Output)

		// Calculate how much we can fit
		const availableSpace = result.length
		const bytesToWrite = Math.min(outputBytes.length, availableSpace)

		// Log what we're about to replace
		const currentContent = plaintext.slice(result.position, result.position + result.length)
		logger.info(`OPRF #${idx} replacing at pos ${result.position}-${result.position + result.length}: "${Buffer.from(currentContent).toString('utf8')}" -> "${base64Output.substring(0, result.length)}"`)

		// Show context
		const contextBefore = plaintext.slice(Math.max(0, result.position - 20), result.position)
		const contextAfter = plaintext.slice(result.position + result.length, Math.min(plaintext.length, result.position + result.length + 20))
		logger.info(`OPRF #${idx} context: "${Buffer.from(contextBefore).toString('utf8')}[${Buffer.from(currentContent).toString('utf8')}]${Buffer.from(contextAfter).toString('utf8')}")`)

		// Replace the range with base64 output (truncated if necessary)
		let actualBytesWritten = 0
		for(let i = 0; i < bytesToWrite; i++) {
			if(result.position + i < modifiedPlaintext.length) {
				modifiedPlaintext[result.position + i] = outputBytes[i]
				actualBytesWritten++
			} else {
				logger.warn(`OPRF #${idx}: Tried to write at position ${result.position + i} but it's out of bounds (plaintext length: ${modifiedPlaintext.length})`)
			}
		}

		// Fill remaining space with asterisks if output is shorter
		for(let i = bytesToWrite; i < availableSpace; i++) {
			if(result.position + i < modifiedPlaintext.length) {
				modifiedPlaintext[result.position + i] = 42 // '*' character
			}
		}

		// Log result
		const newContent = modifiedPlaintext.slice(result.position, result.position + result.length)
		logger.info(`OPRF #${idx} completed: wrote ${actualBytesWritten} bytes, result="${Buffer.from(newContent).toString('utf8')}"`)
	}

	logger.info(`Replaced ${oprfResults.length} OPRF ranges in plaintext`)
	return modifiedPlaintext
}