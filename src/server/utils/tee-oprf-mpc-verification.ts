/**
 * TEE OPRF MPC Verification
 * Verifies OPRF MPC outputs from TEE_K and TEE_T match
 *
 * Unlike ZK OPRF which requires proof verification, OPRF MPC outputs
 * are already trusted because they are included in TEE-signed payloads.
 * This module verifies that both TEEs computed identical outputs.
 */

import type { KOutputPayload, TOutputPayload } from '#src/proto/tee-bundle.ts'
import type { OprfVerificationResult } from '#src/server/utils/tee-oprf-verification.ts'
import type { Logger } from '#src/types/general.ts'
import { AttestorError } from '#src/utils/error.ts'

/**
 * Verifies OPRF MPC outputs from TEE_K and TEE_T match
 * Returns verified outputs for transcript replacement (same format as ZK OPRF)
 */
export function verifyOprfMpcOutputs(
	kPayload: KOutputPayload,
	tPayload: TOutputPayload,
	logger: Logger
): OprfVerificationResult[] {
	const kOutputs = kPayload.oprfOutputs || []
	const tOutputs = tPayload.oprfOutputs || []

	// Empty is valid - no OPRF MPC was requested
	if(kOutputs.length === 0 && tOutputs.length === 0) {
		logger.debug('No OPRF MPC outputs to verify')
		return []
	}

	// Count must match between TEE_K and TEE_T
	if(kOutputs.length !== tOutputs.length) {
		throw new AttestorError(
			'ERROR_INVALID_CLAIM',
			`OPRF MPC count mismatch: TEE_K has ${kOutputs.length}, TEE_T has ${tOutputs.length}`
		)
	}

	logger.info(`Verifying ${kOutputs.length} OPRF MPC outputs`)

	const results: OprfVerificationResult[] = []

	for(const [i, kOut] of kOutputs.entries()) {
		const tOut = tOutputs[i]

		// Validate position bounds (must be non-negative)
		if(kOut.tlsStart < 0 || tOut.tlsStart < 0) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`OPRF MPC invalid position at index ${i}: negative start position`
			)
		}

		// Validate length constraints (must be positive and <= 64 bytes, matching TEE validation)
		if(kOut.tlsLength <= 0 || kOut.tlsLength > 64 || tOut.tlsLength <= 0 || tOut.tlsLength > 64) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`OPRF MPC invalid length at index ${i}: must be 1-64 bytes ` +
				`(TEE_K: ${kOut.tlsLength}, TEE_T: ${tOut.tlsLength})`
			)
		}

		// Validate hash output size (must be exactly 32 bytes for SHA256)
		if(kOut.hashOutput.length !== 32 || tOut.hashOutput.length !== 32) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`OPRF MPC invalid hash size at index ${i}: expected 32 bytes ` +
				`(TEE_K: ${kOut.hashOutput.length}, TEE_T: ${tOut.hashOutput.length})`
			)
		}

		// Verify positions match
		if(kOut.tlsStart !== tOut.tlsStart || kOut.tlsLength !== tOut.tlsLength) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`OPRF MPC position mismatch at index ${i}: ` +
				`TEE_K [${kOut.tlsStart}:${kOut.tlsStart + kOut.tlsLength}] vs ` +
				`TEE_T [${tOut.tlsStart}:${tOut.tlsStart + tOut.tlsLength}]`
			)
		}

		// Verify hash outputs match (hash = SHA256(CMAC), so this implies CMAC matched too)
		if(!buffersEqual(kOut.hashOutput, tOut.hashOutput)) {
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`OPRF MPC hash mismatch at index ${i}: outputs differ between TEE_K and TEE_T`
			)
		}

		// Log the actual output data for debugging
		const hashOutputHex = Buffer.from(kOut.hashOutput).toString('hex')
		const hashOutputBase64 = Buffer.from(kOut.hashOutput).toString('base64')
		logger.info(
			{
				index: i,
				position: kOut.tlsStart,
				length: kOut.tlsLength,
				hashOutputLen: kOut.hashOutput.length,
				hashOutputHex: hashOutputHex.substring(0, 32) + '...',
				hashOutputBase64Preview: hashOutputBase64.substring(0, 20) + '...'
			},
			'OPRF MPC output verified'
		)

		// Return in same format as ZK OPRF for unified replacement
		// MPC OPRF uses full hash length (not truncated like TOPRF)
		results.push({
			position: kOut.tlsStart,
			length: kOut.tlsLength,
			output: new Uint8Array(kOut.hashOutput), // Use SHA256(CMAC) as the replacement value
			isMPC: true
		})
	}

	logger.info(`Successfully verified ${results.length} OPRF MPC outputs`)
	return results
}

/**
 * Compare two Uint8Array buffers for equality
 */
function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
	if(a.length !== b.length) {
		return false
	}

	for(const [i, element] of a.entries()) {
		if(element !== b[i]) {
			return false
		}
	}

	return true
}
