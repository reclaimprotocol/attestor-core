/**
 * GCP attestation validation utilities
 * Validates JWT tokens from Google Confidential Computing
 */

import crypto, { X509Certificate } from 'crypto'

import type { Logger } from '#src/types/general.ts'

export interface GcpValidationResult {
	isValid: boolean
	errors: string[]
	ethAddress?: Uint8Array
	userDataType?: string
	pcr0?: string
}

interface JwtHeader {
	kid?: string
	alg: string
	x5c?: string[] // Certificate chain for PKI tokens
}

interface JwtPayload {
	iss: string
	exp: number
	iat: number
	aud: string
	eat_nonce?: string // Contains "tee_k_public_key:0x..." or "tee_t_public_key:0x..."
	dbgstat?: string // Debug status: "enabled" or "disabled-since-boot"
	// GCP Confidential Computing specific claims
	google?: {
		compute_engine?: {
			image_digest?: string
			instance_id?: string
			project_id?: string
		}
	}
	// Alternative location for image digest (Confidential Space)
	submods?: {
		container?: {
			image_digest?: string
			image_reference?: string
			image_id?: string
			restart_policy?: string
			args?: string[]
			env?: Record<string, string>
		}
		gce?: {
			zone?: string
			project_id?: string
			project_number?: string
			instance_name?: string
			instance_id?: string
		}
	}
}

interface JwkKey {
	kid: string
	n: string // modulus (base64url)
	e: string // exponent (base64url)
	kty: string
	alg: string
	use: string
}

interface JwksResponse {
	keys: JwkKey[]
}

// Cache for Google's public keys
let gcpKeysCache: JwksResponse | null = null
let gcpKeysCacheTime = 0
const GCP_KEYS_CACHE_TTL = 3600000 // 1 hour in milliseconds

// GCP Confidential Space Root CA
const GCP_CONFIDENTIAL_SPACE_ROOT_CA = `-----BEGIN CERTIFICATE-----
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
uyT5CnJulxSC5CT1
-----END CERTIFICATE-----`

/**
 * Base64url decode (RFC 4648, no padding)
 */
function base64urlDecode(input: string): Buffer {
	// Add padding if needed
	let base64 = input.replace(/-/g, '+').replace(/_/g, '/')
	while(base64.length % 4) {
		base64 += '='
	}

	return Buffer.from(base64, 'base64')
}

/**
 * Fetch Google's public keys (with caching)
 */
async function fetchGooglePublicKeys(logger?: Logger): Promise<JwksResponse> {
	const now = Date.now()

	// Return cached keys if still valid
	if(gcpKeysCache && (now - gcpKeysCacheTime) < GCP_KEYS_CACHE_TTL) {
		if(logger) {
			logger.debug('Using cached Google public keys')
		}

		return gcpKeysCache
	}

	// Fetch fresh keys
	if(logger) {
		logger.info('Fetching Google public keys from https://www.googleapis.com/oauth2/v3/certs')
	}

	const response = await fetch('https://www.googleapis.com/oauth2/v3/certs')
	if(!response.ok) {
		throw new Error(`Failed to fetch Google keys: ${response.status} ${response.statusText}`)
	}

	const keys = await response.json() as JwksResponse

	// Update cache
	gcpKeysCache = keys
	gcpKeysCacheTime = now

	if(logger) {
		logger.info(`Fetched ${keys.keys.length} Google public keys`)
	}

	return keys
}

/**
 * Convert JWK to RSA public key
 */
function jwkToPublicKey(jwk: JwkKey): crypto.KeyObject {
	// Create RSA public key from modulus and exponent
	return crypto.createPublicKey({
		key: {
			kty: 'RSA',
			n: jwk.n,
			e: jwk.e,
		},
		format: 'jwk'
	})
}

/**
 * Verify x5c certificate chain and return leaf certificate's public key
 */
function verifyX5cChain(x5cChain: string[], logger?: Logger): crypto.KeyObject {
	if(!x5cChain || x5cChain.length === 0) {
		throw new Error('Empty x5c certificate chain')
	}

	// Parse leaf certificate (first in chain)
	const leafCertPem = `-----BEGIN CERTIFICATE-----\n${x5cChain[0]}\n-----END CERTIFICATE-----`
	const leafCert = new X509Certificate(leafCertPem)

	if(logger) {
		logger.info(`x5c leaf certificate: subject=${leafCert.subject}, issuer=${leafCert.issuer}`)
	}

	// Parse root CA
	const rootCert = new X509Certificate(GCP_CONFIDENTIAL_SPACE_ROOT_CA)

	// For chain verification with Node.js X509Certificate, we need to verify each cert in sequence
	// Start with leaf and work up to root
	let currentCert = leafCert

	// Verify intermediate certificates if present
	for(let i = 1; i < x5cChain.length; i++) {
		const intermediatePem = `-----BEGIN CERTIFICATE-----\n${x5cChain[i]}\n-----END CERTIFICATE-----`
		const intermediateCert = new X509Certificate(intermediatePem)

		// Verify current cert was signed by intermediate
		const isValid = currentCert.verify(intermediateCert.publicKey)
		if(!isValid) {
			throw new Error(`Certificate chain verification failed at level ${i}`)
		}

		if(logger) {
			logger.debug(`Verified cert level ${i}: ${intermediateCert.subject}`)
		}

		currentCert = intermediateCert
	}

	// Verify the top cert was signed by root CA
	const isRootValid = currentCert.verify(rootCert.publicKey)
	if(!isRootValid) {
		throw new Error('Certificate chain does not root to GCP Confidential Space Root CA')
	}

	if(logger) {
		logger.info('x5c certificate chain verified successfully')
	}

	// Return leaf certificate's public key for signature verification
	return leafCert.publicKey
}

/**
 * Validates GCP JWT attestation and extracts ETH address
 */
export async function validateGcpAttestationAndExtractKey(
	attestationBytes: Uint8Array,
	logger?: Logger
): Promise<GcpValidationResult> {
	const errors: string[] = []

	try {
		// 1. Parse JWT structure
		const jwtString = Buffer.from(attestationBytes).toString('utf8')
		const parts = jwtString.split('.')

		if(parts.length !== 3) {
			errors.push('Invalid JWT format: expected 3 parts')
			return { isValid: false, errors }
		}

		const [headerB64, payloadB64, signatureB64] = parts

		// Decode header and payload
		const headerJson = base64urlDecode(headerB64).toString('utf8')
		const payloadJson = base64urlDecode(payloadB64).toString('utf8')

		const header: JwtHeader = JSON.parse(headerJson)
		const payload: JwtPayload = JSON.parse(payloadJson)

		if(logger) {
			logger.info(`GCP JWT header: kid=${header.kid}, alg=${header.alg}`)
			logger.info(`GCP JWT payload: iss=${payload.iss}, aud=${payload.aud}`)
		}

		// 2. Verify claims
		const now = Math.floor(Date.now() / 1000)

		// Check issuer - accept both Google accounts and Confidential Computing
		const validIssuers = [
			'https://accounts.google.com',
			'https://confidentialcomputing.googleapis.com'
		]
		if(!validIssuers.includes(payload.iss)) {
			errors.push(`Invalid issuer: expected one of ${validIssuers.join(', ')}, got "${payload.iss}"`)
		}

		// Check expiration
		if(payload.exp <= now) {
			errors.push(`Token expired: exp=${payload.exp}, now=${now}`)
		}

		// Check issued at (allow 60 second clock skew)
		if(payload.iat > now + 60) {
			errors.push(`Token issued in future: iat=${payload.iat}, now=${now}`)
		}

		// Audience can be:
		// 1. Custom Reclaim audience with data param: https://reclaimprotocol.org/attestation?data=tee_k_public_key:0x...
		// 2. Reclaim domain only: https://reclaim-protocol.com (address in eat_nonce)
		// 3. GCP STS audience: https://sts.googleapis.com (for Confidential Space)
		const hasReclaimAudience = payload.aud?.includes('reclaimprotocol.org')
		const hasGcpStsAudience = payload.aud?.includes('sts.googleapis.com')

		if(!hasReclaimAudience && !hasGcpStsAudience) {
			errors.push(`Invalid audience: expected "reclaimprotocol.org" or "sts.googleapis.com", got "${payload.aud}"`)
		}

		if(errors.length > 0) {
			return { isValid: false, errors }
		}

		// 3. Get public key - either from x5c chain or JWKS
		let publicKey: crypto.KeyObject

		if(header.x5c && header.x5c.length > 0) {
			// PKI token with certificate chain
			if(logger) {
				logger.info(`Using x5c certificate chain (${header.x5c.length} certificates)`)
			}

			publicKey = verifyX5cChain(header.x5c, logger)
		} else if(header.kid) {
			// OIDC token with kid
			if(logger) {
				logger.info(`Using OIDC token with kid: ${header.kid}`)
			}

			// Fetch Google's public keys
			const jwks = await fetchGooglePublicKeys(logger)

			// Find matching key
			const jwk = jwks.keys.find(k => k.kid === header.kid)
			if(!jwk) {
				errors.push(`No public key found for kid: ${header.kid}`)
				return { isValid: false, errors }
			}

			publicKey = jwkToPublicKey(jwk)
		} else {
			errors.push('JWT header must contain either x5c or kid field')
			return { isValid: false, errors }
		}

		// 4. Verify signature
		const signedData = `${headerB64}.${payloadB64}`
		const signature = base64urlDecode(signatureB64)

		const verify = crypto.createVerify('RSA-SHA256')
		verify.update(signedData)
		const isSignatureValid = verify.verify(publicKey, signature)

		if(!isSignatureValid) {
			errors.push('Signature verification failed')
			return { isValid: false, errors }
		}

		if(logger) {
			logger.info('GCP JWT signature verified successfully')
		}

		// 5. Extract ETH address from eat_nonce
		if(!payload.eat_nonce) {
			errors.push('No eat_nonce field found in JWT payload')
			return { isValid: false, errors }
		}

		// Format: "tee_k_public_key:0x..." or "tee_t_public_key:0x..."
		const match = payload.eat_nonce.match(/^(tee_[kt])_public_key:0x([0-9a-fA-F]{40})$/)
		if(!match) {
			errors.push(`Invalid eat_nonce format: ${payload.eat_nonce}`)
			return { isValid: false, errors }
		}

		const userDataType = match[1] // "tee_k" or "tee_t"
		const hexAddress = match[2]

		const ethAddress = new Uint8Array(20)
		for(let i = 0; i < 20; i++) {
			ethAddress[i] = parseInt(hexAddress.substr(i * 2, 2), 16)
		}

		if(logger) {
			logger.info(`Extracted address from eat_nonce: ${payload.eat_nonce}`)
		}

		// Extract image digest from JWT payload (GCP's equivalent to PCR0)
		let pcr0 = 'gcp-no-digest'
		if(payload.google?.compute_engine?.image_digest) {
			pcr0 = payload.google.compute_engine.image_digest
		} else if(payload.submods?.container?.image_digest) {
			pcr0 = payload.submods.container.image_digest
		}

		// Add debug prefix if debug mode is enabled
		if(payload.dbgstat === 'enabled' && pcr0.startsWith('sha256:')) {
			pcr0 = 'debug_' + pcr0
		}

		if(logger) {
			const hexAddr = Buffer.from(ethAddress).toString('hex')
			logger.info(`Extracted ETH address from GCP attestation: 0x${hexAddr}, type: ${userDataType}, pcr0: ${pcr0}`)
		}

		return {
			isValid: true,
			errors: [],
			ethAddress,
			userDataType,
			pcr0
		}

	} catch(error) {
		const errorMsg = error instanceof Error ? error.message : String(error)
		errors.push(`GCP attestation validation error: ${errorMsg}`)
		return { isValid: false, errors }
	}
}
