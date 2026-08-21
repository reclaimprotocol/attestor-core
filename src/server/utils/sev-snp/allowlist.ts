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

import { SNP_BASE_PREFIX } from '#src/server/utils/sev-snp/verify.ts'

// Per-cloud base UKI (snp-base:<hex(PCR11)>). GCP = SHA-256, AWS = SHA-384.
const BAKED_BASES = [
	'snp-base:e51ea77d7a1a7b435e1141e1f8de1cf3cbbabf9602cad6e060b80c4029f36ff6', // GCP legacy
	'snp-base:4832908152fc6619b45bdfe6cddb3399c73101cb323983f10923c6c871b19cd92cd08c6d54064840e108566f4d84f6d7', // AWS legacy
	'snp-base:848bc6bf294c76d2002ee313d8994a1601fa4ed478a017d0b3cc7a50a30bfc11', // GCP Go 1.27 base
	'snp-base:5451db58f0e355b07a81c4b7f0675cc1f2c27d91e82f564837ab92afd2b32c68f190486995677b5162cd7c6f1cade1b5', // AWS same-guest broker base
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
