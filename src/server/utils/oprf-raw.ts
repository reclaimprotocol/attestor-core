import { ethers } from 'ethers'

import { TOPRF_DOMAIN_SEPARATOR } from '#src/config/index.ts'
import type { MessageReveal_OPRFRawMarker as OPRFRawMarker } from '#src/proto/api.ts'
import type { Logger } from '#src/types/index.ts'
import { getEnvVariable } from '#src/utils/env.ts'
import { makeDefaultOPRFOperator } from '#src/utils/zk.ts'

export type OPRFRawResult = {
	/** Location of the data that was OPRF'd */
	dataLocation: {
		fromIndex: number
		length: number
	}
	/** The OPRF nullifier (hash output) */
	nullifier: Uint8Array
}

/**
 * Compute OPRF for plaintext data marked with oprf-raw.
 * This runs server-side since the attestor has access to the revealed plaintext.
 *
 * @param plaintext - The revealed plaintext from the TLS transcript
 * @param markers - Positions in the plaintext to compute OPRF for
 * @param logger - Logger instance
 * @returns Array of OPRF results with nullifiers
 */
export async function computeOPRFRaw(
	plaintext: Uint8Array,
	markers: OPRFRawMarker[],
	logger: Logger
): Promise<OPRFRawResult[]> {
	if(!markers.length) {
		return []
	}

	const PRIVATE_KEY_STR = getEnvVariable('TOPRF_SHARE_PRIVATE_KEY')
	const PUBLIC_KEY_STR = getEnvVariable('TOPRF_SHARE_PUBLIC_KEY')
	if(!PRIVATE_KEY_STR || !PUBLIC_KEY_STR) {
		throw new Error('TOPRF keys not configured. Cannot compute oprf-raw.')
	}

	const privateKey = ethers.utils.arrayify(PRIVATE_KEY_STR)
	const publicKey = ethers.utils.arrayify(PUBLIC_KEY_STR)

	// Use gnark engine for server-side OPRF (same as TOPRF handler)
	const operator = makeDefaultOPRFOperator('chacha20', 'gnark', logger)

	const results: OPRFRawResult[] = []

	for(const marker of markers) {
		const { dataLocation } = marker
		if(!dataLocation) {
			logger.warn('oprf-raw marker missing dataLocation, skipping')
			continue
		}

		const { fromIndex, length } = dataLocation
		const endIndex = fromIndex + length

		if(endIndex > plaintext.length) {
			throw new Error(
				`oprf-raw marker out of bounds: fromIndex=${fromIndex}, length=${length}, plaintextLength=${plaintext.length}`
			)
		}

		// Extract the data to OPRF
		const data = plaintext.slice(fromIndex, endIndex)

		// Generate OPRF request (server-side, we do the full flow)
		const request = await operator.generateOPRFRequestData(
			data,
			TOPRF_DOMAIN_SEPARATOR,
			logger
		)

		// Evaluate OPRF with server's private key
		const response = await operator.evaluateOPRF(
			privateKey,
			request.maskedData,
			logger
		)

		// Finalize to get the nullifier
		const nullifier = await operator.finaliseOPRF(
			publicKey,
			request,
			[{ ...response, publicKeyShare: publicKey }],
			logger
		)

		results.push({
			dataLocation: { fromIndex, length },
			nullifier
		})

		logger.debug(
			{ fromIndex, length, nullifierHex: Buffer.from(nullifier).toString('hex').slice(0, 16) + '...' },
			'computed oprf-raw nullifier'
		)
	}

	return results
}
