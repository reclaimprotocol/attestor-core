/**
 * Working Nitro Attestation validation utilities
 */

import { AsnParser } from '@peculiar/asn1-schema'
import { SubjectPublicKeyInfo } from '@peculiar/asn1-x509'
import { Crypto } from '@peculiar/webcrypto'
import { X509Certificate, X509ChainBuilder } from '@peculiar/x509'
import { sign } from 'cose-js'

// Nitro-specific types
export interface AttestationDocument {
	module_id: string
	digest: string
	timestamp: bigint
	pcrs: { [key: number]: Buffer }
	certificate: Buffer
	cabundle: Buffer[]
	public_key?: Buffer
	user_data?: Buffer
	nonce?: Buffer
}

export interface NitroValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
	userDataType?: 'tee_k' | 'tee_t'
	ethAddress?: string
}

export interface AddressExtractionResult {
	teeType: 'tee_k' | 'tee_t'
	ethAddress?: string
}

// Helper function to dynamically import cbor-x
async function getCborDecode() {
	const { decode } = await import('cbor-x')
	return decode
}

// AWS Nitro root certificate (from nitrite)
const AWS_NITRO_ROOT_CERT = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28TcPQXCEPZ3BABIeTPYwEoCWZE
h8l5YoQwTcU/9KNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`

// Expected PCR values (replace with actual values)
const EXPECTED_PCRS = {
	0: Buffer.from('000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex'),
}

// Secure buffer comparison to prevent timing attacks
function secureBufferCompare(a: Buffer, b: Buffer): boolean {
	if(a.length !== b.length) {
		return false
	}

	let result = 0
	for(const [i, element] of a.entries()) {
		result |= element ^ b[i]
	}

	return result === 0
}

// Enhanced certificate chain validation
async function validateCertificateChain(
	targetCert: X509Certificate,
	intermediateCerts: X509Certificate[],
	rootCert: X509Certificate,
	crypto: Crypto
): Promise<{ isValid: boolean, errors: string[], chain: X509Certificate[] }> {
	const errors: string[] = []

	try {
		// Validate root certificate is self-signed and trusted
		const rootSubject = rootCert.subject
		const rootIssuer = rootCert.issuer

		if(rootSubject !== rootIssuer) {
			errors.push('Root certificate is not self-signed')
		}

		// Verify root certificate signature (self-verification)
		try {
			const isRootValid = await rootCert.verify(undefined, crypto)
			if(!isRootValid) {
				errors.push('Root certificate signature verification failed')
			}
		} catch(error) {
			errors.push(`Root certificate verification failed: ${(error as Error).message}`)
		}

		// Build the certificate chain
		const chainBuilder = new X509ChainBuilder({
			certificates: [rootCert, ...intermediateCerts]
		})

		let chain: X509Certificate[]
		try {
			chain = await chainBuilder.build(targetCert, crypto)
		} catch(error) {
			errors.push(`Certificate chain building failed: ${(error as Error).message}`)
			return { isValid: false, errors, chain: [] }
		}

		if(!chain || chain.length === 0) {
			errors.push('No valid certificate chain could be built')
			return { isValid: false, errors, chain: [] }
		}

		// Validate each certificate in the chain
		const now = new Date()
		for(let i = 0; i < chain.length; i++) {
			const cert = chain[i]

			// Check expiration dates
			if(now < cert.notBefore) {
				errors.push(`Certificate ${i} (${cert.subject}) is not yet valid`)
			}

			if(now > cert.notAfter) {
				errors.push(`Certificate ${i} (${cert.subject}) has expired`)
			}

			// Verify each certificate's signature (except root which is self-signed)
			if(i < chain.length - 1) {
				try {
					const issuer = chain[i + 1]
					const isValid = await cert.verify(issuer, crypto)
					// eslint-disable-next-line max-depth
					if(!isValid) {
						errors.push(`Certificate ${i} signature verification failed`)
					}
				} catch(error) {
					errors.push(`Certificate ${i} verification failed: ${(error as Error).message}`)
				}
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			chain
		}
	} catch(error) {
		errors.push(`Certificate chain validation error: ${(error as Error).message}`)
		return { isValid: false, errors, chain: [] }
	}
}

/**
 * Extract public key from user_data field in attestation document
 */
function extractPublicKeyFromUserData(userDataBuffer: Buffer): AddressExtractionResult | null {
	try {
		const userDataString = userDataBuffer.toString('utf-8')

		// Parse new format: "tee_k_public_key:0xETH_ADDRESS" or "tee_t_public_key:0xETH_ADDRESS"
		const teeKMatch = userDataString.match(/^tee_k_public_key:(0x[0-9a-fA-F]{40})$/)
		const teeTMatch = userDataString.match(/^tee_t_public_key:(0x[0-9a-fA-F]{40})$/)

		if(teeKMatch) {
			return {
				teeType: 'tee_k',
				ethAddress: teeKMatch[1] // Store the full ETH address with 0x prefix
			}
		}

		if(teeTMatch) {
			return {
				teeType: 'tee_t',
				ethAddress: teeTMatch[1] // Store the full ETH address with 0x prefix
			}
		}

		return null
	} catch(error) {
		return null
	}
}

/**
 * Working validation function copied from nitroattestor
 */
export async function validateNitroAttestationAndExtractKey(
	attestationBytes: Uint8Array
): Promise<NitroValidationResult> {
	const errors: string[] = []
	const warnings: string[] = []

	try {
		// Set up WebCrypto
		const crypto = new Crypto()

		// Decode CBOR - use exact same approach as working nitroattestor
		const decode = await getCborDecode()
		let decoded: any
		try {
			decoded = decode(Buffer.from(attestationBytes))
		} catch(error) {
			errors.push(`CBOR decoding failed: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		// Extract COSE_Sign1 structure
		if(!Array.isArray(decoded) || decoded.length < 4) {
			errors.push('Invalid COSE_Sign1 structure: expected array with 4 elements')
			return { isValid: false, errors, warnings }
		}

		const [, , payload] = decoded

		// Validate payload exists and is not empty
		if(!payload || payload.length === 0) {
			errors.push('Empty or missing payload in COSE_Sign1 structure')
			return { isValid: false, errors, warnings }
		}

		// Decode payload - use exact same approach as working code
		let doc: AttestationDocument
		try {
			doc = decode(payload) as AttestationDocument
		} catch(error) {
			errors.push(`Payload decoding failed: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		// Validate mandatory fields with strict type checking
		if(doc.module_id.length === 0) {
			errors.push('Missing or invalid module_id')
		}

		if(doc.digest.length === 0) {
			errors.push('Missing or invalid digest')
		}

		if(!doc.pcrs || typeof doc.pcrs !== 'object') {
			errors.push('Missing or invalid pcrs')
		}

		if(!Buffer.isBuffer(doc.certificate) || doc.certificate.length === 0) {
			errors.push('Missing or invalid certificate')
		}

		if(!Array.isArray(doc.cabundle) || doc.cabundle.length === 0) {
			errors.push('Missing or invalid cabundle')
		}

		// Early return if basic validation fails
		if(errors.length > 0) {
			return { isValid: false, errors, warnings }
		}

		// Validate PCRs with secure comparison
		for(const [index, expected] of Object.entries(EXPECTED_PCRS)) {
			const pcrIndex = parseInt(index)
			const actualPcr = doc.pcrs[pcrIndex]

			if(!Buffer.isBuffer(actualPcr)) {
				errors.push(`PCR${index} is not a Buffer`)
				continue
			}

			if(!secureBufferCompare(expected, actualPcr)) {
				errors.push(`PCR${index} mismatch`)
			}
		}

		// Parse certificates with better error handling
		const intermediateCerts: X509Certificate[] = []
		for(let i = 0; i < doc.cabundle.length; i++) {
			try {
				const cert = new X509Certificate(doc.cabundle[i].buffer as ArrayBuffer)
				intermediateCerts.push(cert)
			} catch(error) {
				errors.push(`Failed to parse cabundle certificate ${i}: ${(error as Error).message}`)
			}
		}

		// Parse target certificate
		let targetCert: X509Certificate
		try {
			targetCert = new X509Certificate(doc.certificate.buffer as ArrayBuffer)
		} catch(error) {
			errors.push(`Failed to parse target certificate: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		// Parse root certificate
		let rootCert: X509Certificate
		try {
			rootCert = new X509Certificate(AWS_NITRO_ROOT_CERT)
		} catch(error) {
			errors.push(`Failed to parse AWS Nitro root certificate: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		// Enhanced certificate chain validation
		const chainResult = await validateCertificateChain(targetCert, intermediateCerts, rootCert, crypto)
		if(!chainResult.isValid) {
			errors.push(...chainResult.errors)
			return { isValid: false, errors, warnings }
		}

		// Parse and validate public key
		let publicKeyRaw: Buffer
		try {
			publicKeyRaw = Buffer.from(targetCert.publicKey.rawData)
		} catch(error) {
			errors.push(`Failed to extract public key: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		// Validate public key format (P-384 ECDSA)
		if(publicKeyRaw.length !== 120 || publicKeyRaw[0] !== 0x30) {
			errors.push(`Invalid public key format: expected 120-byte DER-encoded key, got ${publicKeyRaw.length} bytes`)
			return { isValid: false, errors, warnings }
		}

		let spki: SubjectPublicKeyInfo
		try {
			spki = AsnParser.parse(publicKeyRaw, SubjectPublicKeyInfo)
		} catch(error) {
			errors.push(`Failed to parse SubjectPublicKeyInfo: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		const ecPoint = Buffer.from(spki.subjectPublicKey)
		if(ecPoint.length !== 97 || ecPoint[0] !== 0x04) {
			errors.push('Invalid EC point: expected 97-byte uncompressed P-384 key')
			return { isValid: false, errors, warnings }
		}

		const x = ecPoint.subarray(1, 49) // 48-byte x coordinate
		const y = ecPoint.subarray(49, 97) // 48-byte y coordinate

		// Validate ECDSA signature using cose-js
		try {
			const verifier = {
				key: {
					x: x,
					y: y,
				},
			}
			const options = { defaultType: 18 } // cose.sign.Sign1Tag
			await sign.verify(Buffer.from(attestationBytes), verifier, options)
		} catch(error) {
			errors.push(`COSE signature verification failed: ${(error as Error).message}`)
			return { isValid: false, errors, warnings }
		}

		// Extract public key from user_data if present
		let userDataType: 'tee_k' | 'tee_t' | undefined
		let ethAddress: string | undefined

		if(doc.user_data) {
			const keyInfo = extractPublicKeyFromUserData(doc.user_data)
			if(keyInfo) {
				userDataType = keyInfo.teeType
				ethAddress = keyInfo.ethAddress
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			userDataType,
			ethAddress
		}

	} catch(error) {
		errors.push(`Unexpected error during validation: ${(error as Error).message}`)
		return { isValid: false, errors, warnings }
	}
}
