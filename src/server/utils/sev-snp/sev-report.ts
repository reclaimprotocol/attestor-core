/**
 * AMD SEV-SNP report verifier (proves genuine SEV-SNP hardware + report_data
 * binding). Port of the go-sev-guest verification reclaim-tee invokes:
 * reconstruct the report ABI, verify the ECDSA-P384 report signature against the
 * VLEK/VCEK whose cert chains to the pinned AMD Milan ARK, and check report_data.
 */

import { verify as nodeVerify,X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { AsnConvert } from '@peculiar/asn1-schema'
import { Certificate } from '@peculiar/asn1-x509'
import { X509Certificate as PeculiarCert } from '@peculiar/x509'

import { Attestation, type Report } from '#src/proto/sevsnp.ts'

// assertKDSLeafFormat enforces the AMD KDS cert-format invariants on the
// VLEK/VCEK leaf — the checks go-sev-guest's validateKDSCertificateProductNonspecific
// makes. The leaf is attacker-supplied (unlike the fingerprint-pinned ARK/ASK),
// so its format is constrained: X.509 v3, signed by the AMD root key with
// RSASSA-PSS/SHA-384, carrying an ECDSA P-384 public key.
function assertKDSLeafFormat(der: Uint8Array): void {
	const cert = new PeculiarCert(Buffer.from(der).toString('base64'))

	const sig = cert.signatureAlgorithm as { name: string, hash?: { name: string } }
	if(sig.name !== 'RSA-PSS' || sig.hash?.name !== 'SHA-384') {
		throw new Error(`SEV: leaf cert signed with ${sig.name}/${sig.hash?.name}, want RSASSA-PSS/SHA-384`)
	}

	const key = cert.publicKey.algorithm as { name: string, namedCurve?: string }
	if(key.name !== 'ECDSA' || key.namedCurve !== 'P-384') {
		throw new Error(`SEV: leaf cert key is ${key.name}/${key.namedCurve}, want ECDSA P-384`)
	}

	// tbsCertificate.version is 0-indexed: 2 == X.509 v3.
	const version = AsnConvert.parse(Buffer.from(der), Certificate).tbsCertificate.version
	if(version !== 2) {
		throw new Error(`SEV: leaf cert is X.509 version ${version + 1}, want v3`)
	}
}

const SIGNATURE_OFFSET = 0x2A0
const REPORT_SIZE = 0x4A0
const REPORT_VERSION3 = 3

// go-sev-guest embedded AMD Milan bundles: VLEK = ASVK+ARK, VCEK = ASK+ARK.
const VLEK_BUNDLE_PEM = readFileSync('./cert/sev-snp/ask_ark_milan_vlek.pem')
const VCEK_BUNDLE_PEM = readFileSync('./cert/sev-snp/ask_ark_milan_vcek.pem')

function parsePemBundle(pem: Buffer): X509Certificate[] {
	const blocks = pem.toString('utf8')
		.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
	return blocks.map(b => new X509Certificate(b))
}

// cpuid(1).eax family/model/stepping decode (go-sev-guest abi.FmsFromCpuid1Eax).
function fmsFromCpuid1Eax(eax: number): [number, number, number] {
	const family = ((eax >>> 20) & 0xff) + ((eax >>> 8) & 0xf)
	const model = (((eax >>> 16) & 0xf) << 4) | ((eax >>> 4) & 0xf)
	const stepping = eax & 0xf
	return [family & 0xff, model & 0xff, stepping]
}

// Port of go-sev-guest abi.ReportToAbiBytes; returns the signed component
// report[0:0x2A0] (a zero-filled buffer fills every reserved/MBZ field).
function reportSignedComponent(r: Report): Buffer {
	const d = Buffer.alloc(REPORT_SIZE)
	d.writeUInt32LE(r.version, 0x00)
	d.writeUInt32LE(r.guestSvn, 0x04)
	d.writeBigUInt64LE(r.policy, 0x08)
	Buffer.from(r.familyId).copy(d, 0x10)
	Buffer.from(r.imageId).copy(d, 0x20)
	d.writeUInt32LE(r.vmpl, 0x30)
	d.writeUInt32LE(r.signatureAlgo, 0x34)
	d.writeBigUInt64LE(r.currentTcb, 0x38)
	d.writeBigUInt64LE(r.platformInfo, 0x40)
	d.writeUInt32LE(r.signerInfo, 0x48)
	Buffer.from(r.reportData).copy(d, 0x50)
	Buffer.from(r.measurement).copy(d, 0x90)
	Buffer.from(r.hostData).copy(d, 0xC0)
	Buffer.from(r.idKeyDigest).copy(d, 0xE0)
	Buffer.from(r.authorKeyDigest).copy(d, 0x110)
	Buffer.from(r.reportId).copy(d, 0x140)
	Buffer.from(r.reportIdMa).copy(d, 0x160)
	d.writeBigUInt64LE(r.reportedTcb, 0x180)
	if(r.version >= REPORT_VERSION3) {
		const [family, model, stepping] = fmsFromCpuid1Eax(r.cpuid1eaxFms)
		d[0x188] = family
		d[0x189] = model
		d[0x18A] = stepping
	}

	Buffer.from(r.chipId).copy(d, 0x1A0)
	d.writeBigUInt64LE(r.committedTcb, 0x1E0)
	d[0x1E8] = r.currentBuild & 0xff
	d[0x1E9] = r.currentMinor & 0xff
	d[0x1EA] = r.currentMajor & 0xff
	d[0x1EC] = r.committedBuild & 0xff
	d[0x1ED] = r.committedMinor & 0xff
	d[0x1EE] = r.committedMajor & 0xff
	d.writeBigUInt64LE(r.launchTcb, 0x1F0)
	d.writeBigUInt64LE(r.launchMitVector, 0x1F8)
	d.writeBigUInt64LE(r.currentMitVector, 0x200)
	return d.subarray(0, SIGNATURE_OFFSET)
}

// The 512-byte AMD signature holds r and s as little-endian; P-384 uses the low
// 48 bytes of each. Returns IEEE-P1363 r||s (big-endian, 96 bytes) for node.
function p1363FromAmdSignature(sig: Buffer): Buffer {
	const rBE = Buffer.from(sig.subarray(0x00, 0x30)).reverse()
	const sBE = Buffer.from(sig.subarray(0x48, 0x78)).reverse()
	return Buffer.concat([rBE, sBE])
}

// Walk leaf -> issuer -> ... -> a self-signed cert in the trusted bundle.
function verifyChainToAmdRoot(leaf: X509Certificate, bundle: X509Certificate[], now: Date): void {
	const seen = new Set<string>()
	let cur = leaf
	for(let depth = 0; depth <= bundle.length + 1; depth++) {
		if(now < new Date(cur.validFrom) || now > new Date(cur.validTo)) {
			throw new Error(`SEV: certificate ${cur.subject} outside validity window`)
		}

		// Self-signed terminal must be a cert from the pinned AMD bundle (the ARK).
		if(cur.verify(cur.publicKey)) {
			if(!bundle.some(c => c.fingerprint256 === cur.fingerprint256)) {
				throw new Error('SEV: chain terminates at an untrusted self-signed cert')
			}

			return
		}

		const issuer = bundle.find(c => cur.verify(c.publicKey))
		if(!issuer) {
			throw new Error(`SEV: no valid AMD issuer for ${cur.subject}`)
		}

		if(seen.has(issuer.fingerprint256)) {
			throw new Error('SEV: certificate chain loop')
		}

		seen.add(issuer.fingerprint256)
		cur = issuer
	}

	throw new Error('SEV: chain does not reach the pinned AMD root')
}

/**
 * Verifies the SEV-SNP report: genuine AMD hardware (report sig -> VLEK/VCEK ->
 * Milan ARK) and report_data == expectedReportData. Throws on any failure.
 */
export function verifySevReport(
	sevBytes: Uint8Array,
	expectedReportData: Buffer,
	now: Date = new Date()
): void {
	const att = Attestation.decode(new Uint8Array(sevBytes))
	const report = att.report
	const chain = att.certificateChain
	if(!report || !chain) {
		throw new Error('SEV: attestation missing report or certificate chain')
	}

	// Guest policy + VMPL: the report signature/chain prove genuine AMD hardware
	// but NOT that the guest is non-debuggable or at the highest privilege. A
	// DEBUG-policy guest lets the host decrypt/tamper its memory; reject it, and
	// require VMPL 0. (Mirrors assertSnpReportSafe in the Go verifier.)
	if((report.policy & (1n << 19n)) !== 0n) {
		throw new Error('SEV: guest policy permits DEBUG (host can decrypt guest memory)')
	}

	if(report.vmpl !== 0) {
		throw new Error(`SEV: report VMPL=${report.vmpl}, require 0`)
	}

	// Choose the signer cert by the report's own SignerInfo.SigningKey (0=VCEK,
	// 1=VLEK), not by which cert field happens to be present — otherwise an
	// attacker could attach the other key type. Then chain it to the matching
	// pinned AMD bundle.
	const signingKey = (Number(report.signerInfo) >> 2) & 0x7
	const wantVlek = signingKey === 1
	const vlek = chain.vlekCert?.length ? Buffer.from(chain.vlekCert) : undefined
	const vcek = chain.vcekCert?.length ? Buffer.from(chain.vcekCert) : undefined
	const signerDer = wantVlek ? vlek : vcek
	if(!signerDer) {
		throw new Error(`SEV: report declares ${wantVlek ? 'VLEK' : 'VCEK'} signer but that cert is absent`)
	}

	assertKDSLeafFormat(signerDer)
	const signer = new X509Certificate(signerDer)

	const bundle = parsePemBundle(wantVlek ? VLEK_BUNDLE_PEM : VCEK_BUNDLE_PEM)
	verifyChainToAmdRoot(signer, bundle, now)

	const signed = reportSignedComponent(report)
	const p1363 = p1363FromAmdSignature(Buffer.from(report.signature))
	const ok = nodeVerify(
		'sha384',
		signed,
		{ key: signer.publicKey, dsaEncoding: 'ieee-p1363' },
		p1363
	)
	if(!ok) {
		throw new Error('SEV: report signature invalid')
	}

	if(!Buffer.from(report.reportData).equals(expectedReportData)) {
		throw new Error('SEV: report_data does not match expected binding')
	}
}
