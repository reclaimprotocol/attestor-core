/**
 * TEE Signature Verification Test
 * Tests the complete TEE bundle verification including ETH signature validation
 */

import assert from 'assert'
import { readFileSync } from 'fs'
import { describe, it } from 'node:test'
import { join } from 'path'

import { verifyTeeBundle } from '#src/server/utils/tee-verification.ts'

// Mock logger for testing
const mockLogger = {
	info: (msg: any) => console.log('[INFO]', msg),
	debug: (msg: any) => console.log('[DEBUG]', msg),
	warn: (msg: any) => console.log('[WARN]', msg),
	error: (msg: any) => console.log('[ERROR]', msg)
}

describe('TEE Signature Verification', () => {
	let teeBundleBytes: Uint8Array

	// Load the standalone verification bundle (development mode with public keys)
	const standalonePath = join(__dirname, 'verification_bundle.pb')
	const standaloneBundleBytes = new Uint8Array(readFileSync(standalonePath))

	// Try to load the TEE verification bundle (production mode with attestations)
	try {
		const teePath = join(__dirname, 'verification_bundle_tee.pb')
		teeBundleBytes = new Uint8Array(readFileSync(teePath))
	} catch(error) {
		console.warn('TEE attestation bundle not found, skipping TEE attestation tests')
	}


	it('should verify TEE bundle signatures using embedded public keys', async() => {
		// Mock Date.now() to return a time close to the bundle timestamps for validation
		//const mockTime = 1755774883738 + (2 * 60 * 1000) // 2 minutes after TEE_K timestamp


		try {
			// This should work with embedded public keys (standalone mode)
			const result = await verifyTeeBundle(standaloneBundleBytes, mockLogger as any)

			assert.ok(result.teetSigned.body.length > 0)

		} finally {

		}
	})


	it('should verify TEE bundle with attestations or handle expected test failures', async() => {

		// Mock Date.now() to return a time close to the bundle timestamps for validation
		//const originalDateNow = Date.now
		//const mockTime = 1755698083175 + (2 * 60 * 1000) // 2 minutes after TEE_K timestamp in the TEE bundle

		try {
			// This should work with TEE attestations (production mode)
			const result = await verifyTeeBundle(teeBundleBytes, mockLogger as any)

			assert.ok(result.teekSigned.body.length > 0)


		} catch(error) {


			// For other errors, re-throw
			throw error
		} finally {

		}
	})
})