/**
 * Test with the new verification bundle that contains attestation docs
 */

import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { KOutputPayload, TOutputPayload, VerificationBundle } from 'src/proto/tee-bundle'
import { reconstructTlsTranscript } from 'src/server/utils/tee-transcript-reconstruction'

// Mock logger for testing
const mockLogger = {
	info: jest.fn(),
	debug: jest.fn(),
	warn: jest.fn(),
	error: jest.fn()
}

describe('TEE Bundle Analysis', () => {
	let standaloneBundleBytes: Uint8Array
	let teeBundleBytes: Uint8Array

	beforeAll(() => {
		// Load the standalone verification bundle (development mode with public keys)
		const standalonePath = join(__dirname, 'verification_bundle.pb')
		try {
			standaloneBundleBytes = new Uint8Array(readFileSync(standalonePath))
		} catch(error) {
			console.error('Failed to load standalone bundle:', error)
			throw error
		}

		// Try to load the TEE verification bundle (production mode with attestations)
		try {
			const teePath = join(__dirname, 'verification_bundle_tee.pb')
			teeBundleBytes = new Uint8Array(readFileSync(teePath))
		} catch(error) {
			console.warn('TEE attestation bundle not found, will skip TEE tests')
		}
	})

	it('should validate standalone bundle structure', () => {
		const bundle = VerificationBundle.decode(standaloneBundleBytes)

		// Validate bundle components
		expect(bundle).toBeDefined()
		expect(bundle.teekSigned).toBeDefined()
		expect(bundle.teekSigned?.body).toBeDefined()
		expect(bundle.teekSigned?.body?.length).toBeGreaterThan(0)

		// Check bundle mode
		const hasAttestations = (bundle.teekSigned?.attestationReport?.report && bundle.teekSigned.attestationReport.report.length > 0) ||
			(bundle.teetSigned?.attestationReport?.report && bundle.teetSigned.attestationReport.report.length > 0)
		const hasPublicKeys = (bundle.teekSigned?.ethAddress && bundle.teekSigned.ethAddress.length > 0) ||
			(bundle.teetSigned?.ethAddress && bundle.teetSigned.ethAddress.length > 0)

		// For standalone bundle, should have public keys but not attestations
		expect(hasPublicKeys).toBe(true)
		expect(hasAttestations).toBeFalsy()

		// Validate ETH addresses are present
		expect(bundle.teekSigned?.ethAddress).toBeDefined()
		expect(bundle.teekSigned?.ethAddress?.length).toBeGreaterThan(0)

		// Analyze the K payload
		if(bundle.teekSigned?.body) {
			const kPayload = KOutputPayload.decode(bundle.teekSigned.body)

			// Validate K payload structure
			expect(kPayload.redactedRequest).toBeDefined()
			expect(kPayload.redactedRequest.length).toBeGreaterThan(0)
			expect(kPayload.requestRedactionRanges).toBeDefined()
			expect(Array.isArray(kPayload.requestRedactionRanges)).toBe(true)
			expect(kPayload.consolidatedResponseKeystream).toBeDefined()
			expect(kPayload.consolidatedResponseKeystream?.length).toBeGreaterThan(0)
			expect(kPayload.certificateInfo).toBeDefined()
			expect(kPayload.timestampMs).toBeDefined()
			expect(kPayload.timestampMs).toBeGreaterThan(0)

			// Validate certificate info structure
			if(kPayload.certificateInfo) {
				expect(kPayload.certificateInfo.commonName).toBeDefined()
				expect(typeof kPayload.certificateInfo.commonName).toBe('string')
				expect(kPayload.certificateInfo.issuerCommonName).toBeDefined()
				expect(typeof kPayload.certificateInfo.issuerCommonName).toBe('string')
				expect(Array.isArray(kPayload.certificateInfo.dnsNames)).toBe(true)
			}

			// Validate redaction ranges structure
			for(const range of kPayload.requestRedactionRanges) {
				expect(range.start).toBeGreaterThanOrEqual(0)
				expect(range.length).toBeGreaterThan(0)
				expect(typeof range.type).toBe('string')
				expect(range.type.length).toBeGreaterThan(0)
			}
		}

		// Analyze the T payload (may be missing for standalone mode)
		if(bundle.teetSigned?.body && bundle.teetSigned.body.length > 0) {
			const tPayload = TOutputPayload.decode(bundle.teetSigned.body)

			// Validate T payload structure
			expect(tPayload.consolidatedResponseCiphertext).toBeDefined()
			expect(tPayload.consolidatedResponseCiphertext?.length).toBeGreaterThan(0)
			expect(tPayload.timestampMs).toBeDefined()
			expect(tPayload.timestampMs).toBeGreaterThan(0)
		}
	})

	it('should reconstruct TLS transcript from standalone bundle', async() => {
		const bundle = VerificationBundle.decode(standaloneBundleBytes)

		// Check if we have both TEE_K and TEE_T payloads
		if(!bundle.teekSigned?.body || bundle.teekSigned.body.length === 0) {
			// Skip if missing K payload
			return
		}

		if(!bundle.teetSigned?.body || bundle.teetSigned.body.length === 0) {
			// Skip if missing T payload (expected for standalone bundle)
			return
		}

		const kOutputPayload = KOutputPayload.decode(bundle.teekSigned.body)
		const tOutputPayload = TOutputPayload.decode(bundle.teetSigned.body)

		// Add timestamps to payloads if they don't exist (for older test bundles)
		const now = Date.now()
		if(!kOutputPayload.timestampMs) {
			kOutputPayload.timestampMs = now
		}

		if(!tOutputPayload.timestampMs) {
			tOutputPayload.timestampMs = now
		}

		// Create mock bundle data
		const mockTeeBundleData = {
			teekSigned: bundle.teekSigned,
			teetSigned: bundle.teetSigned,
			teekPublicKey: new Uint8Array(64), // Mock public key
			teetPublicKey: new Uint8Array(64), // Mock public key
			kOutputPayload,
			tOutputPayload,
			handshakeKeys: undefined, // handshakeKeys removed from new bundle format
		}

		const transcriptData = await reconstructTlsTranscript(mockTeeBundleData as any, mockLogger as any)

		// Validate transcript reconstruction results
		expect(transcriptData).toBeDefined()
		expect(transcriptData.revealedRequest).toBeDefined()
		expect(transcriptData.reconstructedResponse).toBeDefined()
		expect(transcriptData.revealedRequest.length).toBeGreaterThan(0)
		expect(transcriptData.reconstructedResponse.length).toBeGreaterThan(0)
		expect(transcriptData.certificateInfo).toBeDefined()

		// Validate revealed request is valid HTTP
		const requestText = new TextDecoder('utf-8', { fatal: false }).decode(transcriptData.revealedRequest)
		expect(requestText.length).toBeGreaterThan(0)

		// Look for HTTP details and validate structure
		const httpMatch = requestText.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP\/[\d.]+/m)
		const hostMatch = requestText.match(/Host:\s*([^\r\n]+)/i)

		if(httpMatch) {
			expect(httpMatch[1]).toMatch(/^(GET|POST|PUT|DELETE|PATCH)$/)
			expect(httpMatch[2]).toMatch(/^\//)
		}

		if(hostMatch) {
			expect(hostMatch[1].trim().length).toBeGreaterThan(0)
		}

		// Validate response is valid HTTP
		const responseText = new TextDecoder('utf-8', { fatal: false }).decode(transcriptData.reconstructedResponse)
		expect(responseText.length).toBeGreaterThan(0)

		const statusMatch = responseText.match(/^HTTP\/[\d.]+\s+(\d+)\s+([^\r\n]+)/m)
		if(statusMatch) {
			const statusCode = parseInt(statusMatch[1])
			expect(statusCode).toBeGreaterThanOrEqual(100)
			expect(statusCode).toBeLessThan(600)
			expect(statusMatch[2].trim().length).toBeGreaterThan(0)
		}

		// Validate certificate info structure
		if(transcriptData.certificateInfo) {
			expect(transcriptData.certificateInfo.commonName).toBeDefined()
			expect(typeof transcriptData.certificateInfo.commonName).toBe('string')
		}
	})

	it('should validate TEE attestation bundle structure', () => {
		if(!teeBundleBytes) {
			// Skip if bundle not available
			return
		}

		const bundle = VerificationBundle.decode(teeBundleBytes)

		// Validate bundle components
		expect(bundle).toBeDefined()
		expect(bundle.teekSigned).toBeDefined()
		expect(bundle.teekSigned?.body).toBeDefined()
		expect(bundle.teekSigned?.body?.length).toBeGreaterThan(0)

		// Check bundle mode
		const hasAttestations = (bundle.teekSigned?.attestationReport?.report && bundle.teekSigned.attestationReport.report.length > 0) ||
			(bundle.teetSigned?.attestationReport?.report && bundle.teetSigned.attestationReport.report.length > 0)
		const hasPublicKeys = (bundle.teekSigned?.ethAddress && bundle.teekSigned.ethAddress.length > 0) ||
			(bundle.teetSigned?.ethAddress && bundle.teetSigned.ethAddress.length > 0)

		// For TEE bundle, should have either attestations or public keys (or both)
		expect(hasAttestations || hasPublicKeys).toBe(true)

		if(hasAttestations) {
			// Validate attestation structure
			if(bundle.teekSigned?.attestationReport) {
				expect(bundle.teekSigned.attestationReport.report).toBeDefined()
				expect(bundle.teekSigned.attestationReport.report.length).toBeGreaterThan(0)
				expect(bundle.teekSigned.attestationReport.type).toBeDefined()
				expect(typeof bundle.teekSigned.attestationReport.type).toBe('string')
			}

			if(bundle.teetSigned?.attestationReport) {
				expect(bundle.teetSigned.attestationReport.report).toBeDefined()
				expect(bundle.teetSigned.attestationReport.report.length).toBeGreaterThan(0)
				expect(bundle.teetSigned.attestationReport.type).toBeDefined()
				expect(typeof bundle.teetSigned.attestationReport.type).toBe('string')
			}
		}

		if(hasPublicKeys) {
			// Validate public key structure
			if(bundle.teekSigned?.ethAddress) {
				expect(bundle.teekSigned.ethAddress.length).toBeGreaterThan(0)
			}

			if(bundle.teetSigned?.ethAddress) {
				expect(bundle.teetSigned.ethAddress.length).toBeGreaterThan(0)
			}
		}

		// Validate K payload
		if(bundle.teekSigned?.body) {
			const kPayload = KOutputPayload.decode(bundle.teekSigned.body)

			// Validate K payload structure
			expect(kPayload.redactedRequest).toBeDefined()
			expect(kPayload.redactedRequest.length).toBeGreaterThan(0)
			expect(kPayload.requestRedactionRanges).toBeDefined()
			expect(Array.isArray(kPayload.requestRedactionRanges)).toBe(true)
			expect(kPayload.consolidatedResponseKeystream).toBeDefined()
			expect(kPayload.consolidatedResponseKeystream?.length).toBeGreaterThan(0)
			expect(kPayload.certificateInfo).toBeDefined()
			expect(kPayload.timestampMs).toBeDefined()
			expect(kPayload.timestampMs).toBeGreaterThan(0)

			// Validate certificate info
			if(kPayload.certificateInfo) {
				expect(kPayload.certificateInfo.commonName).toBeDefined()
				expect(typeof kPayload.certificateInfo.commonName).toBe('string')
				expect(kPayload.certificateInfo.issuerCommonName).toBeDefined()
				expect(typeof kPayload.certificateInfo.issuerCommonName).toBe('string')
				expect(Array.isArray(kPayload.certificateInfo.dnsNames)).toBe(true)
			}

			// Validate redaction ranges
			for(const range of kPayload.requestRedactionRanges) {
				expect(range.start).toBeGreaterThanOrEqual(0)
				expect(range.length).toBeGreaterThan(0)
				expect(typeof range.type).toBe('string')
				expect(range.type.length).toBeGreaterThan(0)
			}
		}

		// Validate T payload
		if(bundle.teetSigned?.body && bundle.teetSigned.body.length > 0) {
			const tPayload = TOutputPayload.decode(bundle.teetSigned.body)

			// Validate T payload structure
			expect(tPayload.consolidatedResponseCiphertext).toBeDefined()
			expect(tPayload.consolidatedResponseCiphertext?.length).toBeGreaterThan(0)
			expect(tPayload.timestampMs).toBeDefined()
			expect(tPayload.timestampMs).toBeGreaterThan(0)
		}
	})

	it('should reconstruct TLS transcript from TEE attestation bundle', async() => {
		if(!teeBundleBytes) {
			// Skip if bundle not available
			return
		}

		const bundle = VerificationBundle.decode(teeBundleBytes)
		const kOutputPayload = KOutputPayload.decode(bundle.teekSigned!.body)
		const tOutputPayload = TOutputPayload.decode(bundle.teetSigned!.body)

		// Add timestamps to payloads if they don't exist (for older test bundles)
		const now = Date.now()
		if(!kOutputPayload.timestampMs) {
			kOutputPayload.timestampMs = now
		}

		if(!tOutputPayload.timestampMs) {
			tOutputPayload.timestampMs = now
		}

		// Create mock bundle data
		const mockTeeBundleData = {
			teekSigned: bundle.teekSigned!,
			teetSigned: bundle.teetSigned!,
			teekPublicKey: new Uint8Array(64), // Mock public key
			teetPublicKey: new Uint8Array(64), // Mock public key
			kOutputPayload,
			tOutputPayload,
			handshakeKeys: undefined, // handshakeKeys removed from new bundle format
		}

		const transcriptData = await reconstructTlsTranscript(mockTeeBundleData as any, mockLogger as any)

		// Validate transcript reconstruction results
		expect(transcriptData).toBeDefined()
		expect(transcriptData.revealedRequest).toBeDefined()
		expect(transcriptData.reconstructedResponse).toBeDefined()
		expect(transcriptData.revealedRequest.length).toBeGreaterThan(0)
		expect(transcriptData.reconstructedResponse.length).toBeGreaterThan(0)
	})
})