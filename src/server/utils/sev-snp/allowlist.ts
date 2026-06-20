/**
 * SEV-SNP code-identity allowlist (the pin point for base + app image hashes).
 *
 * Unlike Confidential Space, a SEV-SNP attestation carries no peer image_digest
 * env var to cross-bind the pair, so trust comes from pinning the known-good
 * hashes here: `app` is the cross-cloud bundle digest (PCR 8, SHA-256), `base`
 * is the per-cloud base UKI (PCR 11: SHA-256 on GCP, SHA-384 on AWS).
 *
 * Rotate by editing these lists or by setting SNP_APP_ALLOWLIST /
 * SNP_BASE_ALLOWLIST (comma-separated, with or without the snp-*: prefix).
 */

import { SNP_APP_PREFIX, SNP_BASE_PREFIX } from './verify.ts'

// Cross-cloud app bundle digests (snp-app:<hex(sha256)>). One per TEE role.
const BAKED_APPS = [
	'snp-app:26d33fd8f9ac470f4f7de521e36ca8c708324342c45ea66c3160a61f2294986b', // tee_k
	'snp-app:8ab735abd0c0f07e490530805225dac8fac35620ad4f1ffcabfa2ffe06320baa', // tee_t
]

// Per-cloud base UKI (snp-base:<hex(PCR11)>). GCP = SHA-256, AWS = SHA-384.
const BAKED_BASES = [
	'snp-base:edf6d8b9e7b6cf19acfd2788ee5c2d33867275deccbe14fbbc184f0e30628256', // GCP
	'snp-base:f708520d03bc589b951fc1a17b32927c5da707341c23a0c886669f86f559fc7dd6ebdf32d4a2242732f33d9dcc345e53', // AWS
]

function buildSet(baked: string[], envName: string, prefix: string): Set<string> {
	const set = new Set(baked.map(v => v.toLowerCase()))
	for(const raw of (process.env[envName] ?? '').split(',')) {
		const v = raw.trim().toLowerCase()
		if(v) {
			set.add(v.startsWith(prefix) ? v : prefix + v)
		}
	}

	return set
}

const APP_ALLOWLIST = buildSet(BAKED_APPS, 'SNP_APP_ALLOWLIST', SNP_APP_PREFIX)
const BASE_ALLOWLIST = buildSet(BAKED_BASES, 'SNP_BASE_ALLOWLIST', SNP_BASE_PREFIX)

/** Throws unless both the app bundle and the base UKI are pinned. */
export function assertSevSnpAllowed(app: string, base: string): void {
	if(!APP_ALLOWLIST.has(app.toLowerCase())) {
		throw new Error(`SEV-SNP app hash "${app}" is not in the allowlist`)
	}

	if(!BASE_ALLOWLIST.has(base.toLowerCase())) {
		throw new Error(`SEV-SNP base hash "${base}" is not in the allowlist`)
	}
}
