/**
 * GCP SEV-SNP leg: go-tpm-tools Attestation. AK cert chains to the Google vTPM
 * root; the SEV report binds sha512(akPub||bound) (anti-splice); the AK-signed
 * TPM2 quote (SHA-256 bank) over PCRs proves PCR 8 (app) + PCR 11 (base).
 * Ports go-tpm-tools quote.Verify + the report_data binding.
 */

import { createHash, type KeyObject, verify as nodeVerify,X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { Attestation as TpmAttestation } from '#src/proto/attest.ts'
import { Attestation as SevAttestation } from '#src/proto/sevsnp.ts'
import type { Quote } from '#src/proto/tpm.ts'
import { verifySevReport } from '#src/server/utils/sev-snp/sev-report.ts'
import { appBaseIdentity, expectedPCR8, type SevSnpEnvelope } from '#src/server/utils/sev-snp/verify.ts'

const GCP_VTPM_ROOT_DER = readFileSync('./cert/sev-snp/gcp_vtpm_ca_root.crt')
const GCP_VTPM_INTERMEDIATE_DER = readFileSync('./cert/sev-snp/gcp_vtpm_ca_intermediate.crt')

const TPM_GENERATED = 0xff544347
const TPM_ST_ATTEST_QUOTE = 0x8018
const TPM_ALG_ECDSA = 0x0018
const HASH_ALGO_SHA256 = 11
const TPM_HASH_TO_NODE: Record<number, string> = { 11: 'sha256', 12: 'sha384', 13: 'sha512' }

// Minimal big-endian reader for TPM2 structures.
class Reader {
	o = 0
	b: Buffer
	constructor(b: Buffer) {
		this.b = b
	}

	u8() { const v = this.b.readUInt8(this.o); this.o += 1; return v }
	u16() { const v = this.b.readUInt16BE(this.o); this.o += 2; return v }
	u32() { const v = this.b.readUInt32BE(this.o); this.o += 4; return v }
	bytes(n: number) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return Buffer.from(v) }
	tpm2b() { return this.bytes(this.u16()) }
}

// TPMT_SIGNATURE (ECDSA): sigAlg, hashAlg, R(TPM2B), S(TPM2B). r/s big-endian.
function parseEcdsaSig(rawSig: Buffer): { r: Buffer, s: Buffer, hash: string } {
	const rd = new Reader(rawSig)
	if(rd.u16() !== TPM_ALG_ECDSA) {
		throw new Error('GCP quote signature is not ECDSA')
	}

	const hash = TPM_HASH_TO_NODE[rd.u16()]
	if(!hash) {
		throw new Error('GCP quote signature hash algorithm unsupported')
	}

	return { r: rd.tpm2b(), s: rd.tpm2b(), hash }
}

// TPMS_ATTEST -> extraData + the quote's internal PCR digest.
function parseAttest(quote: Buffer): { extraData: Buffer, pcrDigest: Buffer } {
	const rd = new Reader(quote)
	if(rd.u32() !== TPM_GENERATED) {
		throw new Error('quote missing TPM_GENERATED magic')
	}

	if(rd.u16() !== TPM_ST_ATTEST_QUOTE) {
		throw new Error('attestation is not a TPM quote')
	}

	rd.tpm2b() // qualifiedSigner
	const extraData = rd.tpm2b()
	rd.bytes(17) // clockInfo
	rd.bytes(8) // firmwareVersion
	const count = rd.u32() // TPML_PCR_SELECTION
	for(let i = 0; i < count; i++) {
		rd.u16() // hash
		rd.bytes(rd.u8()) // pcrSelect bitmap
	}

	return { extraData, pcrDigest: rd.tpm2b() }
}

function padBE(buf: Buffer, size: number): Buffer {
	if(buf.length === size) {
		return buf
	}

	if(buf.length > size) {
		return buf.subarray(buf.length - size)
	}

	const out = Buffer.alloc(size)
	buf.copy(out, size - buf.length)
	return out
}

// go-tpm-tools internal.PCRDigest: hash of pcr[i] for i in 0..23 that are present.
function pcrDigest(pcrs: Record<number, Uint8Array>, hash: string): Buffer {
	const h = createHash(hash)
	for(let i = 0; i < 24; i++) {
		const v = pcrs[i]
		if(v) {
			h.update(Buffer.from(v))
		}
	}

	return h.digest()
}

// Verify the AK-signed quote, its nonce, and that the provided PCRs match the
// signed digest; return PCR 8 / PCR 11.
function verifyQuote(q: Quote, akPub: KeyObject, nonce: Buffer): { pcr8: Buffer, pcr11: Buffer } {
	const { r, s, hash } = parseEcdsaSig(Buffer.from(q.rawSig))
	const fieldSize = akPub.asymmetricKeyDetails?.namedCurve === 'secp384r1' ? 48 : 32
	const p1363 = Buffer.concat([padBE(r, fieldSize), padBE(s, fieldSize)])
	const quoteBytes = Buffer.from(q.quote)
	if(!nodeVerify(hash, quoteBytes, { key: akPub, dsaEncoding: 'ieee-p1363' }, p1363)) {
		throw new Error('GCP quote signature invalid')
	}

	const { extraData, pcrDigest: signedDigest } = parseAttest(quoteBytes)
	if(!extraData.equals(nonce)) {
		throw new Error('GCP quote extraData does not match nonce')
	}

	const pcrs = (q.pcrs?.pcrs ?? {}) as Record<number, Uint8Array>
	if(!pcrDigest(pcrs, hash).equals(signedDigest)) {
		throw new Error('GCP quote PCR digest does not match provided PCRs')
	}

	const pcr8 = pcrs[8]
	const pcr11 = pcrs[11]
	if(!pcr8 || !pcr11) {
		throw new Error('GCP quote missing PCR 8 / PCR 11')
	}

	return { pcr8: Buffer.from(pcr8), pcr11: Buffer.from(pcr11) }
}

// Walk AK cert -> issuer -> ... -> the pinned Google vTPM root.
function verifyAkChain(akCert: X509Certificate, carried: Buffer[], now: Date): void {
	const root = new X509Certificate(GCP_VTPM_ROOT_DER)
	const pool = [
		root,
		new X509Certificate(GCP_VTPM_INTERMEDIATE_DER),
		...carried.map(d => new X509Certificate(d)),
	]
	const seen = new Set<string>()
	let cur = akCert
	for(let depth = 0; depth <= pool.length + 1; depth++) {
		if(now < new Date(cur.validFrom) || now > new Date(cur.validTo)) {
			throw new Error(`GCP AK chain: certificate ${cur.subject} outside validity window`)
		}

		if(cur.fingerprint256 === root.fingerprint256) {
			return
		}

		const issuer = pool.find(c => cur.verify(c.publicKey))
		if(!issuer) {
			throw new Error(`GCP AK chain: no valid issuer for ${cur.subject}`)
		}

		if(seen.has(issuer.fingerprint256)) {
			throw new Error('GCP AK chain: loop')
		}

		seen.add(issuer.fingerprint256)
		cur = issuer
	}

	throw new Error('GCP AK chain does not reach the pinned Google vTPM root')
}

/**
 * Verifies the GCP leg: AK->Google root, SEV report bound to sha512(akPub||bound),
 * AK-signed SHA-256 quote (nonce sha256(bound)) -> PCRs, PCR8 proves the app hash.
 */
export function verifyGcpLeg(
	env: SevSnpEnvelope,
	bound: Buffer,
	now: Date
): { app: string, base: string } {
	if(!env.tpm) {
		throw new Error('GCP SEV-SNP envelope missing go-tpm-tools attestation')
	}

	const att = TpmAttestation.decode(new Uint8Array(env.tpm))
	const akCert = new X509Certificate(Buffer.from(att.akCert))
	verifyAkChain(akCert, att.intermediateCerts.map(c => Buffer.from(c)), now)

	if(!att.sevSnpAttestation) {
		throw new Error('GCP attestation carries no SEV-SNP report')
	}

	const bind = createHash('sha512').update(Buffer.from(att.akPub)).update(bound).digest()
	verifySevReport(SevAttestation.encode(att.sevSnpAttestation).finish(), bind, now)

	const nonce = createHash('sha256').update(bound).digest()
	const quote = att.quotes.find(q => q.pcrs?.hash === HASH_ALGO_SHA256)
	if(!quote) {
		throw new Error('GCP attestation has no SHA-256 vTPM quote')
	}

	const { pcr8, pcr11 } = verifyQuote(quote, akCert.publicKey, nonce)
	if(!pcr8.equals(expectedPCR8(env.app, 'sha256'))) {
		throw new Error('PCR 8 does not match the claimed app hash')
	}

	return appBaseIdentity(env.app, pcr11)
}
