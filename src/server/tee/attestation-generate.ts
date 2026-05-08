import { Buffer } from 'buffer'
import http from 'http'

import type { AttestationReport } from '#src/proto/tee-bundle.ts'
import { logger as LOGGER } from '#src/utils/logger.ts'

const LAUNCHER_SOCKET_PATH = '/run/container_launcher/teeserver.sock'
const LAUNCHER_TOKEN_PATH = '/v1/token'
const LAUNCHER_AUDIENCE = 'https://reclaimprotocol.org'

const CACHE_TTL_MS = 5 * 60 * 1000
const REFRESH_INTERVAL_MS = 4 * 60 * 1000

let cachedJwt: Uint8Array | undefined
let cachedAt = 0
let refreshTimer: NodeJS.Timeout | undefined

/**
 * GCP requires each nonce between 8 and 88 bytes inclusive.
 */
function clampNonce(n: string): string {
	if(n.length < 8) {
		return n.padEnd(8, ' ')
	}

	if(n.length > 88) {
		return n.slice(0, 88)
	}

	return n
}

/**
 * Requests a custom attestation token from the Confidential Space launcher
 * over the unix domain socket. Mirrors reclaim-tee's shared/gcp_attestation.go.
 */
export async function generateAttestationJwt(
	nonces: string[]
): Promise<Uint8Array> {
	const body = JSON.stringify({
		audience: LAUNCHER_AUDIENCE,
		// eslint-disable-next-line camelcase
		token_type: 'PKI',
		nonces: nonces.map(clampNonce)
	})

	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				socketPath: LAUNCHER_SOCKET_PATH,
				path: LAUNCHER_TOKEN_PATH,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body).toString()
				},
				timeout: 10_000
			},
			(res) => {
				const chunks: Buffer[] = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => {
					const data = Buffer.concat(chunks)
					if(res.statusCode !== 200) {
						reject(new Error(
							`launcher returned ${res.statusCode}: ${data.toString('utf8')}`
						))
						return
					}

					resolve(new Uint8Array(data))
				})
			}
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy(new Error('launcher socket timeout'))
		})
		req.write(body)
		req.end()
	})
}

export interface AttestationContext {
	attestorAddress: string
	tlsCertSha256Hex: () => string | undefined
}

let context: AttestationContext | undefined

async function refresh(): Promise<void> {
	if(!context) {
		return
	}

	const nonces = [`attestor_public_key:${context.attestorAddress}`]
	const certHash = context.tlsCertSha256Hex()
	if(certHash) {
		nonces.push(`attestor_cert_hash:${certHash}`)
	}

	cachedJwt = await generateAttestationJwt(nonces)
	cachedAt = Date.now()
	LOGGER.info(
		{ bytes: cachedJwt.length, nonces: nonces.length },
		'tee: refreshed gcp attestation'
	)
}

/**
 * Starts the background attestation refresh loop. The first attestation is
 * generated synchronously so getCachedAttestationJwt() is ready by the time
 * the server begins handling claims.
 */
export async function startAttestationRefresh(
	ctx: AttestationContext
): Promise<void> {
	context = ctx
	await refresh()
	if(refreshTimer) {
		clearInterval(refreshTimer)
	}

	refreshTimer = setInterval(() => {
		refresh().catch((err) => {
			LOGGER.error({ err }, 'tee: attestation refresh failed')
		})
	}, REFRESH_INTERVAL_MS)
	refreshTimer.unref?.()
}

export function stopAttestationRefresh(): void {
	if(refreshTimer) {
		clearInterval(refreshTimer)
		refreshTimer = undefined
	}

	context = undefined
	cachedJwt = undefined
	cachedAt = 0
}

/**
 * Returns the currently-cached attestation JWT bytes, or undefined if no
 * attestation has been generated yet or the cache has expired without a
 * successful refresh.
 */
export function getCachedAttestationJwt(): Uint8Array | undefined {
	if(!cachedJwt) {
		return undefined
	}

	if(Date.now() - cachedAt > CACHE_TTL_MS) {
		return undefined
	}

	return cachedJwt
}

/**
 * Returns an AttestationReport ready to embed in a claim response, or
 * undefined when no attestation is available (i.e. attestor is not running
 * inside a TEE, or the refresh loop has not produced one yet).
 */
export function makeClaimAttestation(): AttestationReport | undefined {
	const report = getCachedAttestationJwt()
	if(!report) {
		return undefined
	}

	return { type: 'gcp', report }
}
