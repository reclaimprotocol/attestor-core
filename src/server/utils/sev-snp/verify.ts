/**
 * SEV-SNP combined attestation verifier (replaces the dead Nitro path).
 *
 * Faithful TS port of reclaim-tee shared/snp_combined_{aws,verify}.go:
 * a 1-byte cloud tag (0x01 GCP / 0x02 AWS) then a CBOR envelope carrying the
 * cross-cloud app hash, the cloud-specific hardware evidence, and the
 * presentable nonce list (the SEV-SNP analogue of a CS JWT eat_nonce).
 */

import { createHash } from 'node:crypto'

import { verifyGcpLeg } from '#src/server/utils/sev-snp/gcp.ts'
import { verifyNitroTpmDocument } from '#src/server/utils/sev-snp/nitrotpm.ts'
import { verifySecureBootEventLog } from '#src/server/utils/sev-snp/secure-boot.ts'
import { verifySevReport } from '#src/server/utils/sev-snp/sev-report.ts'

export const SEV_TAG_GCP = 0x01
export const SEV_TAG_AWS = 0x02
export const SECURE_BOOT_TAG_GCP = 0x03
export const SECURE_BOOT_TAG_AWS = 0x04
export const SNP_APP_PREFIX = 'snp-app:'
export const SNP_BASE_PREFIX = 'snp-base:'

const AWS_V2_DOMAIN = Buffer.from('reclaim/aws-combined-attestation/v2\0', 'utf8')

// Two-tier code identity PCRs: 8 = app bundle (loader-measured), 11 = base UKI.
export const APP_PCR = 8
export const BASE_PCR = 11

export interface SevSnpEnvelope {
	app: Uint8Array
	tpm?: Uint8Array // GCP: go-tpm-tools Attestation proto
	nitrotpm?: Uint8Array // AWS: NitroTPM COSE_Sign1 document
	sev?: Uint8Array // AWS + GCP: go-sev-guest Attestation proto
	sev2?: Uint8Array // AWS: same-guest report bound to the exact NitroTPM document
	eventlog?: Uint8Array // AWS Secure Boot: raw, uncompressed TCG firmware event log
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
	if(!env?.app || env.app.length === 0) {
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

/** Commits the AMD report to the exact NitroTPM evidence from the same broker. */
export function awsCombinedV2ReportData(
	bound: Uint8Array,
	appHash: Uint8Array,
	nitroTpm: Uint8Array
): Buffer {
	const h = createHash('sha512')
	const len8 = Buffer.alloc(8)
	h.update(AWS_V2_DOMAIN)
	for(const field of [bound, appHash, nitroTpm]) {
		len8.writeBigUInt64BE(BigInt(field.length))
		h.update(len8)
		h.update(field)
	}

	return h.digest()
}

/** Only an absent value or an explicit 0 keeps the AWS expansion path active. */
export function requireAwsAttestationV2(
	value: string | undefined = process.env.SNP_AWS_ATTESTATION_V2_REQUIRED
): boolean {
	const normalized = value?.trim() ?? ''
	return normalized !== '' && normalized !== '0'
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

// AWS expansion keeps the legacy caller-bound report and adds sev2. The sev2
// report binds the exact NitroTPM document, app hash, and caller value.
async function verifyAwsLeg(
	env: SevSnpEnvelope,
	bound: Buffer,
	now: Date
): Promise<{ app: string, base: string, pcrs: Map<number, Buffer>, eventLog: Buffer }> {
	if(!env.nitrotpm || (!env.sev && !env.sev2)) {
		throw new Error('AWS SEV-SNP envelope missing SEV report or NitroTPM document')
	}

	const bind = createHash('sha512').update(bound).digest()
	const { pcr8, pcr11, pcrs, userData } = await verifyNitroTpmDocument(env.nitrotpm, now)
	if(!userData.equals(bind)) {
		throw new Error('NitroTPM user_data does not bind the attestation')
	}
	if(env.sev) {
		verifySevReport(env.sev, bind, now)
	}
	if(env.sev2) {
		const v2 = awsCombinedV2ReportData(bound, env.app, env.nitrotpm)
		verifySevReport(env.sev2, v2, now)
	} else if(requireAwsAttestationV2()) {
		throw new Error('AWS combined attestation has no same-guest v2 proof')
	}

	if(!pcr8.equals(expectedPCR8(env.app, 'sha384'))) {
		throw new Error('PCR 8 does not match the claimed app hash')
	}

	return {
		...appBaseIdentity(env.app, pcr11),
		pcrs,
		eventLog: Buffer.from(env.eventlog ?? []),
	}
}

/**
 * Verifies a claim-path combined SEV-SNP attestation end to end and returns the
 * tee type, eth signing key, app/base identities, and the presentable nonces.
 * `now` defaults to the real clock; tests may pass a time in the leaf window.
 */
export async function verifyCombinedSevSnp(
	att: Uint8Array,
	now: Date = new Date()
): Promise<SevSnpResult> {
	const { tag, env } = await parseSevSnpEnvelope(att)
	if(!env.nonces || env.nonces.length === 0) {
		throw new Error('SEV-SNP attestation carries no nonces (not a claim attestation)')
	}

	const bound = snpNonceCommitment(env.nonces)

	let identity: { app: string, base: string }
	if(tag === SEV_TAG_AWS) {
		identity = await verifyAwsLeg(env, bound, now)
	} else if(tag === SEV_TAG_GCP) {
		identity = verifyGcpLeg(env, bound, now)
	} else {
		throw new Error(`unknown SEV-SNP cloud tag 0x${tag.toString(16)}`)
	}

	const { teeType, ethAddress } = extractTeeKeyFromNonces(env.nonces)
	return { teeType, ethAddress, app: identity.app, base: identity.base, nonces: env.nonces }
}

/**
 * Verifies the additive Secure Boot claim format. The cloud-specific leg is
 * unchanged from SEV2; only after it succeeds do we replay PCR 4/7/11 and pin R.
 */
export async function verifyCombinedSecureBoot(
	att: Uint8Array,
	now: Date = new Date()
): Promise<SevSnpResult> {
	const { tag, env } = await parseSevSnpEnvelope(att)
	if(!env.nonces || env.nonces.length === 0) {
		throw new Error('Secure Boot attestation carries no nonces (not a claim attestation)')
	}

	let identity: { app: string, base: string, pcrs: Map<number, Buffer>, eventLog: Buffer }
	let bank: 'sha256' | 'sha384'
	let legacyTag: number
	if(tag === SECURE_BOOT_TAG_AWS) {
		legacyTag = SEV_TAG_AWS
		bank = 'sha384'
	} else if(tag === SECURE_BOOT_TAG_GCP) {
		legacyTag = SEV_TAG_GCP
		bank = 'sha256'
	} else {
		throw new Error(`unknown Secure Boot cloud tag 0x${tag.toString(16)}`)
	}

	// Run the unchanged public SEV2 verifier as the prerequisite. Translating
	// only the tag makes future SEV2 checks automatically apply here as well.
	const legacyEvidence = Buffer.concat([Buffer.from([legacyTag]), Buffer.from(att).subarray(1)])
	const prerequisite = await verifyCombinedSevSnp(legacyEvidence, now)

	// Recover the already-authenticated PCR map for the additive event-log gate.
	// This repeats the cloud leg, but does not create another trust path.
	const bound = snpNonceCommitment(env.nonces)
	if(tag === SECURE_BOOT_TAG_AWS) {
		identity = await verifyAwsLeg(env, bound, now)
	} else {
		identity = verifyGcpLeg(env, bound, now)
	}
	verifySecureBootEventLog(identity.eventLog, identity.pcrs, bank)
	return prerequisite
}
