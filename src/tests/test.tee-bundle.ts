/**
 * Test with the new verification bundle that contains attestation docs
 */

import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ClaimRequestData } from 'src/proto/api'
import { KOutputPayload, TOutputPayload, VerificationBundle } from 'src/proto/tee-bundle'
import { createSyntheticClaimRequest, reconstructTlsTranscript } from 'src/server/utils/tee-transcript-reconstruction'

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

	it('should examine the standalone bundle structure', () => {
		console.log('\n=== Standalone Bundle Analysis ===')

		const bundle = VerificationBundle.decode(standaloneBundleBytes)

		console.log('Bundle Components:')
		console.log('- TEE_K body size:', bundle.teekSigned?.body?.length || 0, 'bytes')
		console.log('- TEE_T body size:', bundle.teetSigned?.body?.length || 0, 'bytes')
		console.log('- Has handshake keys:', false) // handshakeKeys removed from new bundle format

		// Check bundle mode
		const hasAttestations = (bundle.teekSigned?.attestationReport?.report && bundle.teekSigned.attestationReport.report.length > 0) ||
			(bundle.teetSigned?.attestationReport?.report && bundle.teetSigned.attestationReport.report.length > 0)
		const hasPublicKeys = (bundle.teekSigned?.ethAddress && bundle.teekSigned.ethAddress.length > 0) ||
			(bundle.teetSigned?.ethAddress && bundle.teetSigned.ethAddress.length > 0)

		console.log('- Bundle mode:', hasAttestations ? 'Production (with attestations)' : hasPublicKeys ? 'Standalone (with public keys)' : 'Unknown')

		if(hasAttestations) {
			console.log('- TEE_K embedded attestation:', bundle.teekSigned?.attestationReport?.report?.length || 0, 'bytes')
			console.log('- TEE_T embedded attestation:', bundle.teetSigned?.attestationReport?.report?.length || 0, 'bytes')
		}

		if(hasPublicKeys) {
			console.log('- TEE_K embedded eth address:', bundle.teekSigned?.ethAddress?.length || 0, 'bytes')
			console.log('- TEE_T embedded eth address:', bundle.teetSigned?.ethAddress?.length || 0, 'bytes')
		}

		// Analyze the K payload to understand redaction ranges
		if(bundle.teekSigned?.body) {
			const kPayload = KOutputPayload.decode(bundle.teekSigned.body)

			console.log('\nK Payload Analysis:')
			console.log('- Redacted request size:', kPayload.redactedRequest.length, 'bytes')
			console.log('- Request redaction ranges:', kPayload.requestRedactionRanges.length)
			console.log('- Consolidated response keystream:', kPayload.consolidatedResponseKeystream?.length || 0, 'bytes')
			console.log('- Certificate info:', kPayload.certificateInfo ? 'present' : 'missing')
			if(kPayload.certificateInfo) {
				console.log('  - Common name:', kPayload.certificateInfo.commonName)
				console.log('  - Issuer:', kPayload.certificateInfo.issuerCommonName)
				console.log('  - DNS names:', kPayload.certificateInfo.dnsNames.join(', ') || 'none')
			}
			console.log('- Response redaction ranges:', kPayload.responseRedactionRanges.length)
			console.log('- K Timestamp:', kPayload.timestampMs ? new Date(kPayload.timestampMs).toISOString() : 'not set')

			// Analyze redaction range types
			console.log('\nRedaction Range Types:')
			for(const [i, range] of kPayload.requestRedactionRanges.entries()) {
				console.log(`  Range ${i + 1}: start=${range.start}, length=${range.length}, type="${range.type}"`)
			}

		}

		// Analyze the T payload
		if(bundle.teetSigned?.body && bundle.teetSigned.body.length > 0) {
			const tPayload = TOutputPayload.decode(bundle.teetSigned.body)
			console.log('\nT Payload Analysis:')
			console.log('- Consolidated response ciphertext:', tPayload.consolidatedResponseCiphertext?.length || 0, 'bytes')
			console.log('- Request proof streams:', tPayload.requestProofStreams?.length || 0)
			console.log('- T Timestamp:', tPayload.timestampMs ? new Date(tPayload.timestampMs).toISOString() : 'not set')
		} else {
			console.log('\nT Payload Analysis:')
			console.log('- T payload is missing or empty (expected for standalone mode)')
		}

		console.log('\n=== End Analysis ===')
	})

	it('should test transcript reconstruction with standalone bundle', async() => {
		console.log('\n=== Standalone Bundle Transcript Reconstruction ===')

		const bundle = VerificationBundle.decode(standaloneBundleBytes)
		
		// Check if we have both TEE_K and TEE_T payloads
		if(!bundle.teekSigned?.body || bundle.teekSigned.body.length === 0) {
			console.log('⚠️ Skipping transcript reconstruction - missing TEE_K payload')
			return
		}
		
		if(!bundle.teetSigned?.body || bundle.teetSigned.body.length === 0) {
			console.log('⚠️ Skipping transcript reconstruction - missing TEE_T payload (expected for standalone bundle)')
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
			teekSigned: bundle.teekSigned!,
			teetSigned: bundle.teetSigned!,
			teekPublicKey: new Uint8Array(64), // Mock public key
			teetPublicKey: new Uint8Array(64), // Mock public key
			kOutputPayload,
			tOutputPayload,
			handshakeKeys: undefined, // handshakeKeys removed from new bundle format
		}

		try {
			const transcriptData = await reconstructTlsTranscript(mockTeeBundleData as any, mockLogger as any)

			console.log('✅ Transcript reconstruction successful!')
			console.log('- Revealed request size:', transcriptData.revealedRequest.length, 'bytes')
			console.log('- Reconstructed response size:', transcriptData.reconstructedResponse.length, 'bytes')
			console.log('- TLS version:', transcriptData.tlsVersion)
			console.log('- Cipher suite:', transcriptData.cipherSuite)
			console.log('- Certificate info:', transcriptData.certificateInfo ? 'present' : 'missing')

			// Analyze revealed request
			const requestText = new TextDecoder('utf-8', { fatal: false }).decode(transcriptData.revealedRequest)
			console.log('\nRevealed Request Analysis:')
			console.log('- Text length:', requestText.length, 'characters')
			console.log('- Preview:', JSON.stringify(requestText.substring(0, 200)))

			// Look for HTTP details
			const httpMatch = requestText.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP\/[\d.]+/m)
			const hostMatch = requestText.match(/Host:\s*([^\r\n]+)/i)
			if(httpMatch) {
				console.log('- HTTP Method:', httpMatch[1])
				console.log('- Path:', httpMatch[2])
			}

			if(hostMatch) {
				console.log('- Host:', hostMatch[1].trim())
			}

			// Analyze response
			const responseText = new TextDecoder('utf-8', { fatal: false }).decode(transcriptData.reconstructedResponse)
			console.log('\nReconstructed Response Analysis:')
			console.log('- Text length:', responseText.length, 'characters')
			console.log('- Preview:', JSON.stringify(responseText.substring(0, 200)))

			const statusMatch = responseText.match(/^HTTP\/[\d.]+\s+(\d+)\s+([^\r\n]+)/m)
			if(statusMatch) {
				console.log('- HTTP Status:', statusMatch[1], statusMatch[2])
			}

			// Test synthetic request creation
			const claimData: ClaimRequestData = {
				provider: 'http',
				parameters: JSON.stringify({
					url: hostMatch ? `https://${hostMatch[1].trim()}${httpMatch?.[2] || '/'}` : 'https://example.com/',
					method: httpMatch?.[1] || 'GET'
				}),
				owner: '0x1234567890123456789012345678901234567890',
				timestampS: Math.floor(Date.now() / 1000),
				context: '{}'
			}

			const syntheticRequest = createSyntheticClaimRequest(transcriptData, claimData, mockTeeBundleData as any)

			console.log('\nSynthetic request created successfully!')
			console.log('- Transcript messages:', syntheticRequest.transcript.length)
			console.log('- Host extracted:', syntheticRequest.request?.host)

			expect(transcriptData).toBeDefined()
			expect(syntheticRequest).toBeDefined()

		} catch(error) {
			console.error('Reconstruction failed:', (error as Error).message)
			throw error
		}
	})

	it('should examine the TEE attestation bundle structure', () => {
		if(!teeBundleBytes) {
			console.log('\n⚠️ Skipping TEE attestation bundle analysis - bundle not available')
			return
		}

		console.log('\n=== TEE Attestation Bundle Analysis ===')

		const bundle = VerificationBundle.decode(teeBundleBytes)

		console.log('Bundle Components:')
		console.log('- TEE_K body size:', bundle.teekSigned?.body?.length || 0, 'bytes')
		console.log('- TEE_T body size:', bundle.teetSigned?.body?.length || 0, 'bytes')
		console.log('- Has handshake keys:', false) // handshakeKeys removed from new bundle format

		// Check bundle mode
		const hasAttestations = (bundle.teekSigned?.attestationReport?.report && bundle.teekSigned.attestationReport.report.length > 0) ||
			(bundle.teetSigned?.attestationReport?.report && bundle.teetSigned.attestationReport.report.length > 0)
		const hasPublicKeys = (bundle.teekSigned?.ethAddress && bundle.teekSigned.ethAddress.length > 0) ||
			(bundle.teetSigned?.ethAddress && bundle.teetSigned.ethAddress.length > 0)

		console.log('- Bundle mode:', hasAttestations ? 'Production (with attestations)' : hasPublicKeys ? 'Standalone (with public keys)' : 'Unknown')

		if(hasAttestations) {
			console.log('- TEE_K embedded attestation:', bundle.teekSigned?.attestationReport?.report?.length || 0, 'bytes')
			console.log('- TEE_T embedded attestation:', bundle.teetSigned?.attestationReport?.report?.length || 0, 'bytes')
			console.log('- TEE_K attestation type:', bundle.teekSigned?.attestationReport?.type || 'not specified')
			console.log('- TEE_T attestation type:', bundle.teetSigned?.attestationReport?.type || 'not specified')
		}

		if(hasPublicKeys) {
			console.log('- TEE_K embedded eth address:', bundle.teekSigned?.ethAddress?.length || 0, 'bytes')
			console.log('- TEE_T embedded eth address:', bundle.teetSigned?.ethAddress?.length || 0, 'bytes')
		}

		// Analyze the K payload to understand redaction ranges
		if(bundle.teekSigned?.body) {
			const kPayload = KOutputPayload.decode(bundle.teekSigned.body)

			console.log('\nK Payload Analysis:')
			console.log('- Redacted request size:', kPayload.redactedRequest.length, 'bytes')
			console.log('- Request redaction ranges:', kPayload.requestRedactionRanges.length)
			console.log('- Consolidated response keystream:', kPayload.consolidatedResponseKeystream?.length || 0, 'bytes')
			console.log('- Certificate info:', kPayload.certificateInfo ? 'present' : 'missing')
			if(kPayload.certificateInfo) {
				console.log('  - Common name:', kPayload.certificateInfo.commonName)
				console.log('  - Issuer:', kPayload.certificateInfo.issuerCommonName)
				console.log('  - DNS names:', kPayload.certificateInfo.dnsNames.join(', ') || 'none')
			}
			console.log('- Response redaction ranges:', kPayload.responseRedactionRanges.length)
			console.log('- K Timestamp:', kPayload.timestampMs ? new Date(kPayload.timestampMs).toISOString() : 'not set')

			// Analyze redaction range types
			console.log('\nRedaction Range Types:')
			for(const [i, range] of kPayload.requestRedactionRanges.entries()) {
				console.log(`  Range ${i + 1}: start=${range.start}, length=${range.length}, type="${range.type}"`)
			}
		}

		// Analyze the T payload
		if(bundle.teetSigned?.body) {
			const tPayload = TOutputPayload.decode(bundle.teetSigned.body)
			console.log('\nT Payload Analysis:')
			console.log('- Consolidated response ciphertext:', tPayload.consolidatedResponseCiphertext?.length || 0, 'bytes')
			console.log('- Request proof streams:', tPayload.requestProofStreams?.length || 0)
			console.log('- T Timestamp:', tPayload.timestampMs ? new Date(tPayload.timestampMs).toISOString() : 'not set')
		}

		console.log('\n=== End TEE Analysis ===')
	})

	it('should test transcript reconstruction with TEE attestation bundle', async() => {
		if(!teeBundleBytes) {
			console.log('\n⚠️ Skipping TEE bundle transcript reconstruction - bundle not available')
			return
		}

		console.log('\n=== TEE Attestation Bundle Transcript Reconstruction ===')

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

		try {
			const transcriptData = await reconstructTlsTranscript(mockTeeBundleData as any, mockLogger as any)

			console.log('✅ TEE transcript reconstruction successful!')
			console.log('- Revealed request size:', transcriptData.revealedRequest.length, 'bytes')
			console.log('- Reconstructed response size:', transcriptData.reconstructedResponse.length, 'bytes')
			console.log('- TLS version:', transcriptData.tlsVersion)
			console.log('- Cipher suite:', transcriptData.cipherSuite)
			console.log('- Certificate info:', transcriptData.certificateInfo ? 'present' : 'missing')

			// Analyze revealed request
			const requestText = new TextDecoder('utf-8', { fatal: false }).decode(transcriptData.revealedRequest)
			console.log('\nRevealed Request Analysis:')
			console.log('- Text length:', requestText.length, 'characters')
			console.log('- Preview:', JSON.stringify(requestText.substring(0, 200)))

			// Look for HTTP details
			const httpMatch = requestText.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP\/[\d.]+/m)
			const hostMatch = requestText.match(/Host:\s*([^\r\n]+)/i)
			if(httpMatch) {
				console.log('- HTTP Method:', httpMatch[1])
				console.log('- Path:', httpMatch[2])
			}

			if(hostMatch) {
				console.log('- Host:', hostMatch[1].trim())
			}

			// Analyze response
			const responseText = new TextDecoder('utf-8', { fatal: false }).decode(transcriptData.reconstructedResponse)
			console.log('\nReconstructed Response Analysis:')
			console.log('- Text length:', responseText.length, 'characters')
			console.log('- Preview:', JSON.stringify(responseText.substring(0, 200)))

			const statusMatch = responseText.match(/^HTTP\/[\d.]+\s+(\d+)\s+([^\r\n]+)/m)
			if(statusMatch) {
				console.log('- HTTP Status:', statusMatch[1], statusMatch[2])
			}

			// Test synthetic request creation
			const claimData: ClaimRequestData = {
				provider: 'http',
				parameters: JSON.stringify({
					url: hostMatch ? `https://${hostMatch[1].trim()}${httpMatch?.[2] || '/'}` : 'https://example.com/',
					method: httpMatch?.[1] || 'GET'
				}),
				owner: '0x1234567890123456789012345678901234567890',
				timestampS: Math.floor(Date.now() / 1000),
				context: '{}'
			}

			const syntheticRequest = createSyntheticClaimRequest(transcriptData, claimData, mockTeeBundleData as any)

			console.log('\nSynthetic request created successfully!')
			console.log('- Transcript messages:', syntheticRequest.transcript.length)
			console.log('- Host extracted:', syntheticRequest.request?.host)

			expect(transcriptData).toBeDefined()
			expect(syntheticRequest).toBeDefined()

		} catch(error) {
			console.error('TEE reconstruction failed:', (error as Error).message)
			throw error
		}
	})
})