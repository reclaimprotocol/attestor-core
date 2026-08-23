import assert from 'node:assert'
import test from 'node:test'

import { resolveSignedAttestationType } from '#src/server/utils/tee-verification.ts'

test('signed Secure Boot marker upgrades legacy-compatible report type', () => {
	assert.equal(resolveSignedAttestationType('secure-boot', 'sev-snp'), 'secure-boot')
	assert.equal(resolveSignedAttestationType('secure-boot', 'secure-boot'), 'secure-boot')
})

test('bundles without the signed marker keep their existing verifier', () => {
	assert.equal(resolveSignedAttestationType('', 'gcp'), 'gcp')
	assert.equal(resolveSignedAttestationType('', 'sev-snp'), 'sev-snp')
	assert.equal(resolveSignedAttestationType('', 'secure-boot'), 'secure-boot')
})

test('signed generation rejects incompatible report types', () => {
	assert.throws(() => resolveSignedAttestationType('sev-snp', 'secure-boot'), /incompatible/)
	assert.throws(() => resolveSignedAttestationType('secure-boot', 'gcp'), /incompatible/)
	assert.throws(() => resolveSignedAttestationType('unknown', 'sev-snp'), /incompatible/)
})
