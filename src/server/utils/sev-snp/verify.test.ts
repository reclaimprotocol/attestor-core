import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { X509Certificate } from 'node:crypto'

import { verifyNitroTpmDocument } from './nitrotpm.ts'
import { verifySevReport } from './sev-report.ts'
import {
	expectedPCR8,
	extractTeeKeyFromNonces,
	parseSevSnpEnvelope,
	SEV_TAG_AWS,
	SEV_TAG_GCP,
	snpNonceCommitment,
	verifyCombinedSevSnp,
} from './verify.ts'

const fixturesDir = new URL('./fixtures/', import.meta.url)

function loadFixture(name: string): Uint8Array {
	const b64 = readFileSync(new URL(name, fixturesDir), 'utf8').trim()
	return Buffer.from(b64, 'base64')
}

// The NitroTPM leaf cert is only valid ~3h; a committed fixture's window is in
// the past. Verify the crypto as-of the leaf's own window (freshness is a
// production "now" concern, separate from signature/chain correctness).
async function nitroLeafMidValidity(docBytes: Uint8Array): Promise<Date> {
	const { decode } = await import('cbor-x')
	const cose = decode(Buffer.from(docBytes)) as unknown[]
	const doc = decode(Buffer.from(cose[2] as Uint8Array)) as Record<string, unknown>
	const leaf = new X509Certificate(Buffer.from(doc.certificate as Uint8Array))
	return new Date((new Date(leaf.validFrom).getTime() + new Date(leaf.validTo).getTime()) / 2)
}

test('AWS fixture: envelope parses, nonces yield tee_t key', async() => {
	const att = loadFixture('aws_combined.b64')
	const { tag, env } = await parseSevSnpEnvelope(att)
	assert.equal(tag, SEV_TAG_AWS)
	assert.equal(Buffer.from(env.app).toString('hex').slice(0, 8), '8ab735ab')
	assert.ok(env.sev && env.sev.length > 0, 'has SEV report')
	assert.ok(env.nitrotpm && env.nitrotpm.length > 0, 'has NitroTPM doc')
	const { teeType, ethAddress } = extractTeeKeyFromNonces(env.nonces!)
	assert.equal(teeType, 'tee_t')
	assert.equal(ethAddress, '0xc905fc05cb972f468e6fa2ae8b064f9c5b671c82')
})

test('GCP fixture: envelope parses, nonces yield tee_k key', async() => {
	const att = loadFixture('gcp_combined.b64')
	const { tag, env } = await parseSevSnpEnvelope(att)
	assert.equal(tag, SEV_TAG_GCP)
	assert.equal(Buffer.from(env.app).toString('hex').slice(0, 8), '26d33fd8')
	assert.ok(env.tpm && env.tpm.length > 0, 'has go-tpm-tools attestation')
	const { teeType, ethAddress } = extractTeeKeyFromNonces(env.nonces!)
	assert.equal(teeType, 'tee_k')
	assert.equal(ethAddress, '0x0820030535a5822278c789cbccc20739ac92a561')
})

test('AWS NitroTPM doc: COSE_Sign1 + chain verify, binding, PCR8/PCR11', async() => {
	const att = loadFixture('aws_combined.b64')
	const { env } = await parseSevSnpEnvelope(att)
	const validTime = await nitroLeafMidValidity(env.nitrotpm!)
	const { pcr8, pcr11, userData } = await verifyNitroTpmDocument(env.nitrotpm!, validTime)

	// user_data binds sha512(nonceCommitment)
	const bound = snpNonceCommitment(env.nonces!)
	const expectedUD = createHash('sha512').update(bound).digest()
	assert.ok(userData.equals(expectedUD), 'user_data binds the nonce commitment')

	// PCR 11 is the per-cloud base (96-hex SHA-384 bank)
	assert.equal(
		pcr11.toString('hex'),
		'f708520d03bc589b951fc1a17b32927c5da707341c23a0c886669f86f559fc7dd6ebdf32d4a2242732f33d9dcc345e53'
	)

	// PCR 8 proves the claimed cross-cloud app hash
	assert.ok(pcr8.equals(expectedPCR8(env.app, 'sha384')), 'PCR8 == expectedPCR8(app, sha384)')
})

test('AWS SEV report: AMD VLEK chain + ECDSA-P384 + report_data binding', async() => {
	const att = loadFixture('aws_combined.b64')
	const { env } = await parseSevSnpEnvelope(att)
	const bound = snpNonceCommitment(env.nonces!)
	const expectedRD = createHash('sha512').update(bound).digest() // 64 bytes
	// throws on any signature / chain / binding failure
	verifySevReport(env.sev!, expectedRD)
})

test('AWS combined: end-to-end verifyCombinedSevSnp reproduces (app, base, nonces)', async() => {
	const att = loadFixture('aws_combined.b64')
	const { env } = await parseSevSnpEnvelope(att)
	const now = await nitroLeafMidValidity(env.nitrotpm!)
	const r = await verifyCombinedSevSnp(att, now)
	assert.equal(r.teeType, 'tee_t')
	assert.equal(r.ethAddress, '0xc905fc05cb972f468e6fa2ae8b064f9c5b671c82')
	assert.equal(r.app, 'snp-app:8ab735abd0c0f07e490530805225dac8fac35620ad4f1ffcabfa2ffe06320baa')
	assert.equal(
		r.base,
		'snp-base:f708520d03bc589b951fc1a17b32927c5da707341c23a0c886669f86f559fc7dd6ebdf32d4a2242732f33d9dcc345e53'
	)
	assert.equal(r.nonces.length, 2)
})

test('GCP combined: end-to-end verifyCombinedSevSnp reproduces (app, base, nonces)', async() => {
	const att = loadFixture('gcp_combined.b64')
	const r = await verifyCombinedSevSnp(att)
	assert.equal(r.teeType, 'tee_k')
	assert.equal(r.ethAddress, '0x0820030535a5822278c789cbccc20739ac92a561')
	assert.equal(r.app, 'snp-app:26d33fd8f9ac470f4f7de521e36ca8c708324342c45ea66c3160a61f2294986b')
	assert.equal(r.base, 'snp-base:edf6d8b9e7b6cf19acfd2788ee5c2d33867275deccbe14fbbc184f0e30628256')
	assert.equal(r.nonces.length, 2)
})
