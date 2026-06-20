/**
 * SEV-SNP combined attestation verifier (replaces the dead Nitro path).
 *
 * Faithful TS port of reclaim-tee shared/snp_combined_{aws,verify}.go:
 * a 1-byte cloud tag (0x01 GCP / 0x02 AWS) then a CBOR envelope carrying the
 * cross-cloud app hash, the cloud-specific hardware evidence, and the
 * presentable nonce list (the SEV-SNP analogue of a CS JWT eat_nonce).
 */

import { createHash } from 'node:crypto'

export const SEV_TAG_GCP = 0x01
export const SEV_TAG_AWS = 0x02
export const SNP_APP_PREFIX = 'snp-app:'
export const SNP_BASE_PREFIX = 'snp-base:'

// Two-tier code identity PCRs: 8 = app bundle (loader-measured), 11 = base UKI.
export const APP_PCR = 8
export const BASE_PCR = 11

export interface SevSnpEnvelope {
	app: Uint8Array
	tpm?: Uint8Array // GCP: go-tpm-tools Attestation proto
	nitrotpm?: Uint8Array // AWS: NitroTPM COSE_Sign1 document
	sev?: Uint8Array // AWS + GCP: go-sev-guest Attestation proto
	nonces?: string[]
}

export interface SevSnpResult {
	teeType: 'tee_k' | 'tee_t'
	ethAddress: string // 0x-prefixed, lowercase
	app: string // snp-app:<hex(appHash)>  cross-cloud payload identity
	base: string // snp-base:<hex(PCR11)>  per-cloud base UKI
	nonces: string[]
}

/** Splits the 1-byte cloud tag from the CBOR envelope. */
export async function parseSevSnpEnvelope(
	att: Uint8Array
): Promise<{ tag: number, env: SevSnpEnvelope }> {
	if(att.length < 1) {
		throw new Error('empty SEV-SNP attestation')
	}

	const { decode } = await import('cbor-x')
	const env = decode(Buffer.from(att.subarray(1))) as SevSnpEnvelope
	if(!env || !env.app || env.app.length === 0) {
		throw new Error('SEV-SNP envelope missing app hash')
	}

	return { tag: att[0], env }
}

/**
 * snpNonceCommitment: sha256 over, for each nonce, the 8-byte big-endian byte
 * length followed by the utf-8 bytes. Binding this in report_data/user_data is
 * what makes the carried nonces unforgeable.
 */
export function snpNonceCommitment(nonces: string[]): Buffer {
	const h = createHash('sha256')
	const len8 = Buffer.alloc(8)
	for(const n of nonces) {
		const nb = Buffer.from(n, 'utf8')
		len8.writeBigUInt64BE(BigInt(nb.length))
		h.update(len8)
		h.update(nb)
	}

	return h.digest()
}

/**
 * expectedPCR8: the value the loader produces by extending a pristine (all-zero)
 * PCR 8 once with alg(appHash), i.e. alg(0^algSize || alg(appHash)). GCP uses the
 * SHA-256 bank, AWS the SHA-384 bank.
 */
export function expectedPCR8(appHash: Uint8Array, alg: 'sha256' | 'sha384'): Buffer {
	const inner = createHash(alg).update(appHash).digest()
	return createHash(alg).update(Buffer.alloc(inner.length)).update(inner).digest()
}

export function appBaseIdentity(
	appHash: Uint8Array,
	pcr11: Uint8Array
): { app: string, base: string } {
	return {
		app: SNP_APP_PREFIX + Buffer.from(appHash).toString('hex'),
		base: SNP_BASE_PREFIX + Buffer.from(pcr11).toString('hex'),
	}
}

// The signing key is presented as tee_[kt]_public_key:0x<40hex> — the same shape
// the Confidential Space path reads from eat_nonce.
const PUBKEY_NONCE = /^(tee_[kt])_public_key:0x([0-9a-fA-F]{40})$/

export function extractTeeKeyFromNonces(
	nonces: string[]
): { teeType: 'tee_k' | 'tee_t', ethAddress: string } {
	for(const n of nonces) {
		const m = n.match(PUBKEY_NONCE)
		if(m) {
			return { teeType: m[1] as 'tee_k' | 'tee_t', ethAddress: '0x' + m[2].toLowerCase() }
		}
	}

	throw new Error('no tee_[kt]_public_key nonce in SEV-SNP attestation')
}
