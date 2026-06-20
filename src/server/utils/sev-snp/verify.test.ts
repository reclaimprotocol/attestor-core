import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
	extractTeeKeyFromNonces,
	parseSevSnpEnvelope,
	SEV_TAG_AWS,
	SEV_TAG_GCP,
} from './verify.ts'

const fixturesDir = new URL('./fixtures/', import.meta.url)

function loadFixture(name: string): Uint8Array {
	const b64 = readFileSync(new URL(name, fixturesDir), 'utf8').trim()
	return Buffer.from(b64, 'base64')
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
