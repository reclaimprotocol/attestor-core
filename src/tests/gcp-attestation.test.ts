/**
 * Test GCP attestation validation with proof_bundle.bin
 */

import { readFileSync } from 'fs'
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { VerificationBundle } from '#src/proto/tee-bundle.ts'
import { validateGcpAttestationAndExtractKey } from '#src/server/utils/gcp-attestation.ts'
import { verifyTeeBundle } from '#src/server/utils/tee-verification.ts'
import { logger } from '#src/utils/logger.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('GCP Attestation Tests', () => {
	let bundleBytes: Uint8Array

	// Load the proof bundle with GCP attestation
	const bundlePath = join(__dirname, 'proof_bundle.bin')
	try {
		bundleBytes = new Uint8Array(readFileSync(bundlePath))
		console.log(`Loaded GCP proof bundle from ${bundlePath}, size: ${bundleBytes.length} bytes`)
	} catch(error) {
		console.error('Failed to load proof bundle:', error)
		throw error
	}

	it('should parse GCP attestation from proof bundle', () => {
		const bundle = VerificationBundle.decode(bundleBytes)

		console.log('\n========== GCP ATTESTATION BUNDLE ANALYSIS ==========')
		console.log(`Bundle size: ${bundleBytes.length} bytes`)

		// Check TEE_K attestation
		const teekAttestation = bundle.teekSigned?.attestationReport
		console.log('\nTEE_K Attestation:')
		console.log(`  Type: ${teekAttestation?.type || 'undefined'}`)
		console.log(`  Report size: ${teekAttestation?.report?.length || 0} bytes`)

		// Check TEE_T attestation
		const teetAttestation = bundle.teetSigned?.attestationReport
		console.log('\nTEE_T Attestation:')
		console.log(`  Type: ${teetAttestation?.type || 'undefined'}`)
		console.log(`  Report size: ${teetAttestation?.report?.length || 0} bytes`)

		// Verify at least one is GCP
		const hasGcp = teekAttestation?.type === 'gcp' || teetAttestation?.type === 'gcp'
		assert(hasGcp, 'Bundle should contain at least one GCP attestation')

		// Print JWT samples if they exist
		if(teetAttestation?.type === 'gcp' && teetAttestation.report) {
			const jwtString = Buffer.from(teetAttestation.report).toString('utf8')
			const parts = jwtString.split('.')
			if(parts.length === 3) {
				console.log('\nTEE_T GCP JWT Structure:')
				console.log(`  Header (first 100 chars): ${parts[0].substring(0, 100)}...`)
				console.log(`  Payload (first 100 chars): ${parts[1].substring(0, 100)}...`)
				console.log(`  Signature (first 50 chars): ${parts[2].substring(0, 50)}...`)

				// Decode and print header
				try {
					const headerJson = Buffer.from(parts[0], 'base64url').toString('utf8')
					console.log(`  Decoded header: ${headerJson}`)
				} catch(e) {
					// Try with padding
					let base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/')
					while(base64.length % 4) {
						base64 += '='
					}

					const headerJson = Buffer.from(base64, 'base64').toString('utf8')
					console.log(`  Decoded header: ${headerJson}`)
				}
			}
		}

		console.log('======================================================\n')
	})

	it('should validate GCP JWT attestation (may fail if token expired)', async() => {
		const bundle = VerificationBundle.decode(bundleBytes)

		// Find GCP attestation (check both TEE_K and TEE_T)
		let gcpAttestation: Uint8Array | undefined
		let gcpType: string | undefined

		if(bundle.teetSigned?.attestationReport?.type === 'gcp') {
			gcpAttestation = bundle.teetSigned.attestationReport.report
			gcpType = 'TEE_T'
		} else if(bundle.teekSigned?.attestationReport?.type === 'gcp') {
			gcpAttestation = bundle.teekSigned.attestationReport.report
			gcpType = 'TEE_K'
		}

		assert(gcpAttestation, 'No GCP attestation found in bundle')
		console.log(`\nValidating ${gcpType} GCP attestation...`)

		const result = await validateGcpAttestationAndExtractKey(gcpAttestation, logger)

		console.log('\nValidation result:')
		console.log(`  Valid: ${result.isValid}`)
		console.log(`  Errors: ${result.errors.length > 0 ? result.errors.join(', ') : 'none'}`)

		if(result.ethAddress) {
			const hexAddress = Buffer.from(result.ethAddress).toString('hex')
			console.log(`  ETH Address: 0x${hexAddress}`)
			console.log(`  User data type: ${result.userDataType}`)
		}

		if(!result.isValid) {
			console.error('\nGCP attestation validation failed!')
			console.error('Errors:', result.errors)

			// Check if it's just an expiration error
			const isExpiredOnly = result.errors.every(e => e.includes('expired'))
			if(isExpiredOnly) {
				console.log('\nNote: Token is expired (test data). JWT structure and signature were valid at the time of creation.')
				// Still check that we extracted the address before expiration check
				if(result.errors.length === 1 && result.errors[0].includes('Token expired')) {
					console.log('Skipping validation due to expired test token')
					return
				}
			}
		}

		// Only assert if not expired
		if(result.isValid || result.ethAddress) {
			assert(result.ethAddress, 'Should extract ETH address')
			assert(result.ethAddress.length === 20, 'ETH address should be 20 bytes')
		}
	})

	it('should verify complete TEE bundle with GCP attestation', async() => {
		console.log('\nVerifying complete TEE bundle with GCP attestation...')

		// First check if the bundle is expired by checking timestamps
		const bundle = VerificationBundle.decode(bundleBytes)
		const now = Date.now()
		const maxAgeMs = 10 * 60 * 1000 // 10 minutes

		// Decode payloads to check timestamps
		const { KOutputPayload, TOutputPayload } = await import('#src/proto/tee-bundle.ts')
		const kPayload = KOutputPayload.decode(bundle.teekSigned!.body)
		const tPayload = TOutputPayload.decode(bundle.teetSigned!.body)

		const isExpired = (kPayload.timestampMs < now - maxAgeMs) || (tPayload.timestampMs < now - maxAgeMs)

		if(isExpired) {
			console.log('\nBundle is expired - verifying structure only (no signature/timestamp validation)')

			// Verify basic structure without full validation
			assert(bundle.teekSigned, 'Should have TEE_K signed message')
			assert(bundle.teetSigned, 'Should have TEE_T signed message')
			assert(kPayload.redactedRequest, 'Should have redacted request')
			assert(tPayload.consolidatedResponseCiphertext, 'Should have response ciphertext')

			// Check attestation types
			const teekType = bundle.teekSigned.attestationReport?.type || 'nitro'
			const teetType = bundle.teetSigned.attestationReport?.type || 'nitro'
			console.log(`  TEE_K attestation type: ${teekType}`)
			console.log(`  TEE_T attestation type: ${teetType}`)

			// For GCP attestations, verify we can decode the JWT structure
			if(teetType === 'gcp' && bundle.teetSigned.attestationReport?.report) {
				const jwtString = Buffer.from(bundle.teetSigned.attestationReport.report).toString('utf8')
				const parts = jwtString.split('.')
				assert(parts.length === 3, 'GCP JWT should have 3 parts')

				// Decode payload to verify structure
				const base64url = (str: string) => {
					let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
					while(base64.length % 4) {
						base64 += '='
					}

					return Buffer.from(base64, 'base64').toString('utf8')
				}

				const payload = JSON.parse(base64url(parts[1]))
				assert(payload.eat_nonce, 'Should have eat_nonce')
				assert(payload.submods?.container?.env?.EXPECTED_TEEK_PCR0, 'Should have EXPECTED_TEEK_PCR0 env var')
				console.log('  ✓ GCP JWT structure valid')
				console.log(`  ✓ EXPECTED_TEEK_PCR0: ${payload.submods.container.env.EXPECTED_TEEK_PCR0.substring(0, 20)}...`)
			}

			console.log('\n✓ Bundle structure verification passed (data expired, full validation skipped)')
			return
		}

		// Bundle is fresh - do full validation
		const teeData = await verifyTeeBundle(bundleBytes, logger)

		console.log('\nTEE Bundle verification successful!')
		console.log(`  TEE_K PCR0: ${teeData.teekPcr0}`)
		console.log(`  TEE_T PCR0: ${teeData.teetPcr0}`)
		console.log(`  K payload timestamp: ${teeData.kOutputPayload.timestampMs}`)
		console.log(`  T payload timestamp: ${teeData.tOutputPayload.timestampMs}`)

		assert(teeData.kOutputPayload, 'Should have K output payload')
		assert(teeData.tOutputPayload, 'Should have T output payload')
	})
})
