import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { decode } from 'cbor-x'

import { VerificationBundle } from '#src/proto/tee-bundle.ts'
import { verifyNitroSignature } from '#src/server/utils/nitro-signature.ts'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' })
const protectedHeader = Buffer.from('a1013822', 'hex') // {1: -35} (ES384)
const payload = Buffer.from('nitro payload')
// RFC 9052 Sig_structure: ["Signature1", h'a1013822', h'', h'6e6974726f207061796c6f6164'].
const signedData = Buffer.from('846a5369676e61747572653144a1013822404d6e6974726f207061796c6f6164', 'hex')
const signature = sign('sha384', signedData, { key: privateKey, dsaEncoding: 'ieee-p1363' })
const cose = [protectedHeader, new Map(), payload, signature]

describe('Nitro COSE_Sign1 signature', () => {
	it('verifies a P-384 signature over the COSE Sig_structure', () => {
		verifyNitroSignature(cose, publicKeyDer)
	})

	it('verifies the existing AWS Nitro attestation fixture', () => {
		const bundle = VerificationBundle.decode(readFileSync(new URL('./proof_bundle.bin', import.meta.url)))
		const attestation = bundle.teekSigned!.attestationReport!
		assert.equal(attestation.type, 'nitro')
		const document = decode(Buffer.from(attestation.report)) as unknown[]
		const payload = decode(document[2] as Buffer)
		const key = new X509Certificate(payload.certificate).publicKey
		verifyNitroSignature(document, key.export({ format: 'der', type: 'spki' }))
	})

	it('rejects a changed payload, protected header, signature or key', () => {
		assert.throws(() => verifyNitroSignature([
			protectedHeader, new Map(), Buffer.from('other payload'), signature
		], publicKeyDer))
		assert.throws(() => verifyNitroSignature([
			Buffer.from('a2013822044161', 'hex'), new Map(), payload, signature
		], publicKeyDer))
		const changedSignature = Buffer.from(signature)
		changedSignature[0] ^= 1
		assert.throws(() => verifyNitroSignature([
			protectedHeader, new Map(), payload, changedSignature
		], publicKeyDer))
		const otherKey = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey
		assert.throws(() => verifyNitroSignature(cose, otherKey.export({ format: 'der', type: 'spki' })))
	})

	it('rejects missing or unsupported algorithms and malformed signatures', () => {
		for(const header of ['a0', 'a10126', 'a1013823', '00']) {
			assert.throws(() => verifyNitroSignature([
				Buffer.from(header, 'hex'), new Map(), payload, signature
			], publicKeyDer))
		}

		assert.throws(() => verifyNitroSignature(cose.slice(0, 3), publicKeyDer))
		assert.throws(() => verifyNitroSignature([...cose, Buffer.alloc(0)], publicKeyDer))
		assert.throws(() => verifyNitroSignature([
			protectedHeader, new Map(), payload, signature.subarray(1)
		], publicKeyDer))
		const wrongCurve = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey
		assert.throws(() => verifyNitroSignature(cose, wrongCurve.export({ format: 'der', type: 'spki' })))
	})

	it('uses the original protected header bytes when verifying', () => {
		// The map length uses a valid non-minimal encoding. It must not be re-encoded.
		const header = Buffer.from('b801013822', 'hex')
		const data = Buffer.from('846a5369676e61747572653145b801013822404d6e6974726f207061796c6f6164', 'hex')
		const sig = sign('sha384', data, { key: privateKey, dsaEncoding: 'ieee-p1363' })
		verifyNitroSignature([header, new Map(), payload, sig], publicKeyDer)
	})

	it('supports the existing unprotected algorithm header format', () => {
		const data = Buffer.from('846a5369676e61747572653140404d6e6974726f207061796c6f6164', 'hex')
		const sig = sign('sha384', data, { key: privateKey, dsaEncoding: 'ieee-p1363' })
		verifyNitroSignature([Buffer.alloc(0), new Map([[1, -35]]), payload, sig], publicKeyDer)
	})
})
