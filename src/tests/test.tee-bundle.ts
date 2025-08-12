/**
 * Test with the new verification bundle that contains attestation docs
 */

import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ClaimRequestData } from 'src/proto/api'
import { KOutputPayload, TOutputPayload, VerificationBundlePB } from 'src/proto/tee-bundle'
import { createSyntheticClaimRequest, reconstructTlsTranscript } from 'src/server/utils/tee-transcript-reconstruction'

// Mock logger for testing
const mockLogger = {
	info: jest.fn(),
	debug: jest.fn(),
	warn: jest.fn(),
	error: jest.fn()
}

describe('New Bundle with Attestation Docs', () => {
	let newBundleBytes: Uint8Array

	beforeAll(() => {
		// Load the new verification bundle with attestation docs
		const bundlePath = join(__dirname, 'verification_bundle_session_1.pb')
		try {
			newBundleBytes = new Uint8Array(readFileSync(bundlePath))
		} catch(error) {
			console.error('Failed to load new bundle:', error)
			throw error
		}
	})

	it('should examine the new bundle structure', () => {
		console.log('\n=== New Bundle Analysis ===')

		const bundle = VerificationBundlePB.decode(newBundleBytes)

		console.log('Bundle Components:')
		console.log('- TEE_K body size:', bundle.teekSigned?.body?.length || 0, 'bytes')
		console.log('- TEE_T body size:', bundle.teetSigned?.body?.length || 0, 'bytes')
		console.log('- Has handshake keys:', !!bundle.handshakeKeys)
		console.log('- Has opening:', !!bundle.opening)
		console.log('- Separate TEE_K attestation:', bundle.attestationTeeK?.length || 0, 'bytes')
		console.log('- Separate TEE_T attestation:', bundle.attestationTeeT?.length || 0, 'bytes')
		console.log('- TEE_K embedded attestation:', bundle.teekSigned?.attestationReport?.report?.length || 0, 'bytes')
		console.log('- TEE_T embedded attestation:', bundle.teetSigned?.attestationReport?.report?.length || 0, 'bytes')

		// Analyze the K payload to understand redaction ranges
		if(bundle.teekSigned?.body) {
			const kPayload = KOutputPayload.decode(bundle.teekSigned.body)

			console.log('\nK Payload Analysis:')
			console.log('- Redacted request size:', kPayload.redactedRequest.length, 'bytes')
			console.log('- Request redaction ranges:', kPayload.requestRedactionRanges.length)
			console.log('- Handshake packets:', kPayload.packets.length)
			console.log('- Redacted streams:', kPayload.redactedStreams.length)
			console.log('- Response redaction ranges:', kPayload.responseRedactionRanges.length)

			// Analyze redaction range types
			console.log('\nRedaction Range Types:')
			for(const [i, range] of kPayload.requestRedactionRanges.entries()) {
				console.log(`  Range ${i + 1}: start=${range.start}, length=${range.length}, type="${range.type}"`)
			}

			// Show proof stream info
			if(bundle.opening) {
				console.log('\nProof Stream:')
				console.log('- Proof stream length:', bundle.opening.proofStream.length, 'bytes')
				console.log('- Proof key length:', bundle.opening.proofKey?.length || 0, 'bytes')
			}
		}

		console.log('\n=== End Analysis ===')
	})

	it('should test transcript reconstruction with correct proof stream logic', async() => {
		console.log('\n Testing Transcript Reconstruction with Fixed Logic')

		const bundle = VerificationBundlePB.decode(newBundleBytes)
		const kOutputPayload = KOutputPayload.decode(bundle.teekSigned!.body)
		const tOutputPayload = TOutputPayload.decode(bundle.teetSigned!.body)

		// Create mock bundle data
		const mockTeeBundleData = {
			teekSigned: bundle.teekSigned!,
			teetSigned: bundle.teetSigned!,
			teekPublicKey: new Uint8Array(64), // Mock public key
			teetPublicKey: new Uint8Array(64), // Mock public key
			kOutputPayload,
			tOutputPayload,
			handshakeKeys: bundle.handshakeKeys,
			opening: bundle.opening
		}

		try {
			const transcriptData = await reconstructTlsTranscript(mockTeeBundleData as any, mockLogger as any)

			console.log(' Transcript reconstruction successful!')
			console.log('- Handshake packets:', transcriptData.handshakePackets.length)
			console.log('- Revealed request size:', transcriptData.revealedRequest.length, 'bytes')
			console.log('- Reconstructed response size:', transcriptData.reconstructedResponse.length, 'bytes')
			console.log('- TLS version:', transcriptData.tlsVersion)
			console.log('- Cipher suite:', transcriptData.cipherSuite)

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
})
