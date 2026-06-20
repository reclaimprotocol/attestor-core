/**
 * SEV-SNP base-image allowlist (the pin point for base UKI hashes).
 *
 * The attestor pins only the per-cloud base UKI (PCR 11: SHA-256 on GCP,
 * SHA-384 on AWS) — that is its root of trust. The cross-cloud app bundle
 * digest (PCR 8) is NOT pinned here; it is published into the claim context
 * for the claim consumer to verify against its own policy.
 *
 * Rotate by editing this list or by setting SNP_BASE_ALLOWLIST (comma-separated,
 * with or without the snp-base: prefix).
 */

import { SNP_BASE_PREFIX } from './verify.ts'

// Per-cloud base UKI (snp-base:<hex(PCR11)>). GCP = SHA-256, AWS = SHA-384.
const BAKED_BASES = [
	'snp-base:edf6d8b9e7b6cf19acfd2788ee5c2d33867275deccbe14fbbc184f0e30628256', // GCP
	'snp-base:f708520d03bc589b951fc1a17b32927c5da707341c23a0c886669f86f559fc7dd6ebdf32d4a2242732f33d9dcc345e53', // AWS
]

function buildBaseSet(): Set<string> {
	const set = new Set(BAKED_BASES.map(v => v.toLowerCase()))
	for(const raw of (process.env.SNP_BASE_ALLOWLIST ?? '').split(',')) {
		const v = raw.trim().toLowerCase()
		if(v) {
			set.add(v.startsWith(SNP_BASE_PREFIX) ? v : SNP_BASE_PREFIX + v)
		}
	}

	return set
}

const BASE_ALLOWLIST = buildBaseSet()

/** Throws unless the base UKI hash is pinned. */
export function assertSevSnpBaseAllowed(base: string): void {
	if(!BASE_ALLOWLIST.has(base.toLowerCase())) {
		throw new Error(`SEV-SNP base hash "${base}" is not in the allowlist`)
	}
}
