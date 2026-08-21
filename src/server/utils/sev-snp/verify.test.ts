import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { assertSevSnpBaseAllowed } from '#src/server/utils/sev-snp/allowlist.ts'
import { verifyNitroTpmDocument } from '#src/server/utils/sev-snp/nitrotpm.ts'
import { verifySevReport } from '#src/server/utils/sev-snp/sev-report.ts'
import {
	awsCombinedV2ReportData,
	expectedPCR8,
	extractTeeKeyFromNonces,
	parseSevSnpEnvelope,
	requireAwsAttestationV2,
	SEV_TAG_AWS,
	SEV_TAG_GCP,
	snpNonceCommitment,
	verifyCombinedSevSnp,
} from '#src/server/utils/sev-snp/verify.ts'

const fixturesDir = './fixtures/sev-snp/'

function loadFixture(name: string): Uint8Array {
	const b64 = readFileSync(fixturesDir + name, 'utf8').trim()
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

test('AWS v2 commitment binds the caller, app hash, and exact NitroTPM document', () => {
	const bound = Buffer.from('bound')
	const app = Buffer.alloc(32, 0x42)
	const doc = Buffer.from('signed NitroTPM document')
	const expected = awsCombinedV2ReportData(bound, app, doc)

	assert.notDeepEqual(awsCombinedV2ReportData(Buffer.from('other'), app, doc), expected)
	assert.notDeepEqual(awsCombinedV2ReportData(bound, Buffer.alloc(32, 0x43), doc), expected)
	assert.notDeepEqual(awsCombinedV2ReportData(bound, app, Buffer.from('other')), expected)
})

test('AWS v2 policy rejects a legacy envelope', async() => {
	const att = loadFixture('aws_combined.b64')
	const { env } = await parseSevSnpEnvelope(att)
	const now = await nitroLeafMidValidity(env.nitrotpm!)
	const prior = process.env.SNP_AWS_ATTESTATION_V2_REQUIRED
	process.env.SNP_AWS_ATTESTATION_V2_REQUIRED = '1'
	try {
		await assert.rejects(verifyCombinedSevSnp(att, now), /no same-guest v2 proof/)
	} finally {
		if(prior === undefined) {
			delete process.env.SNP_AWS_ATTESTATION_V2_REQUIRED
		} else {
			process.env.SNP_AWS_ATTESTATION_V2_REQUIRED = prior
		}
	}
})

test('AWS expansion rejects an invalid sev2 report when legacy sev is valid', async() => {
	const legacy = loadFixture('aws_combined.b64')
	const { tag, env } = await parseSevSnpEnvelope(legacy)
	const { encode } = await import('cbor-x')
	const expanded = Buffer.concat([
		Buffer.from([tag]),
		Buffer.from(encode({ ...env, sev2: env.sev })),
	])
	const now = await nitroLeafMidValidity(env.nitrotpm!)
	await assert.rejects(
		verifyCombinedSevSnp(expanded, now),
		/report_data does not match expected binding/
	)
})

test('AWS v2 policy fails secure on configuration typos', () => {
	assert.equal(requireAwsAttestationV2(undefined), false)
	assert.equal(requireAwsAttestationV2('0'), false)
	assert.equal(requireAwsAttestationV2('1'), true)
	assert.equal(requireAwsAttestationV2('true'), true)
	assert.equal(requireAwsAttestationV2('typo'), true)
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

test('allowlist: pins both per-cloud base hashes and rejects unknown ones', () => {
	assert.doesNotThrow(() => assertSevSnpBaseAllowed('snp-base:e51ea77d7a1a7b435e1141e1f8de1cf3cbbabf9602cad6e060b80c4029f36ff6'))
	assert.doesNotThrow(() => assertSevSnpBaseAllowed('snp-base:4832908152fc6619b45bdfe6cddb3399c73101cb323983f10923c6c871b19cd92cd08c6d54064840e108566f4d84f6d7'))
	assert.doesNotThrow(() => assertSevSnpBaseAllowed('snp-base:848bc6bf294c76d2002ee313d8994a1601fa4ed478a017d0b3cc7a50a30bfc11'))
	assert.doesNotThrow(() => assertSevSnpBaseAllowed('snp-base:5451db58f0e355b07a81c4b7f0675cc1f2c27d91e82f564837ab92afd2b32c68f190486995677b5162cd7c6f1cade1b5'))
	assert.throws(() => assertSevSnpBaseAllowed('snp-base:' + 'ad'.repeat(32)), /base hash/)
})
