/**
 * AWS NitroTPM attestation document verifier (the AWS code-identity proof).
 *
 * Port of reclaim-tee shared/snp_combined_aws.go verifyNitroTPMDocument: the doc
 * is a COSE_Sign1 (ES384) whose leaf cert chains to the pinned AWS Nitro root;
 * its nitrotpm_pcrs carry PCR 8 (app) + PCR 11 (base) and user_data carries the
 * hardware binding.
 */

import { verify as nodeVerify,X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

const NITRO_ROOT_PEM = readFileSync(
	new URL('./certs/aws_nitro_root.pem', import.meta.url)
)

export interface NitroTpmResult {
	pcr8: Buffer
	pcr11: Buffer
	userData: Buffer
}

// nitrotpm_pcrs is a CBOR map with integer keys; cbor-x may surface it as a Map
// or a plain object depending on key types — handle both.
function pcrValue(pcrs: unknown, n: number): Buffer | undefined {
	if(pcrs instanceof Map) {
		const v = pcrs.get(n) ?? pcrs.get(BigInt(n))
		return v ? Buffer.from(v as Uint8Array) : undefined
	}

	const o = pcrs as Record<string, Uint8Array> | undefined
	const v = o?.[String(n)]
	return v ? Buffer.from(v) : undefined
}

// Walk leaf -> issuer -> ... -> pinned Nitro root. An issuer is any cabundle/root
// cert whose key verifies the current cert's signature; require termination at
// the pinned root and that every cert is within its validity window.
function verifyChainToNitroRoot(
	leaf: X509Certificate,
	cabundle: X509Certificate[],
	now: Date
): void {
	const root = new X509Certificate(NITRO_ROOT_PEM)
	const pool = [root, ...cabundle]
	const seen = new Set<string>()

	let cur = leaf
	for(let depth = 0; depth <= pool.length; depth++) {
		if(now < new Date(cur.validFrom) || now > new Date(cur.validTo)) {
			throw new Error(`NitroTPM: certificate ${cur.subject} outside validity window`)
		}

		if(cur.fingerprint256 === root.fingerprint256) {
			return
		}

		const issuer = pool.find(c => cur.verify(c.publicKey))
		if(!issuer) {
			throw new Error(`NitroTPM: no valid issuer for ${cur.subject}`)
		}

		if(seen.has(issuer.fingerprint256)) {
			throw new Error('NitroTPM: certificate chain loop')
		}

		seen.add(issuer.fingerprint256)
		cur = issuer
	}

	throw new Error('NitroTPM: chain does not terminate at the pinned Nitro root')
}

/**
 * Verifies the NitroTPM COSE_Sign1 document and returns PCR 8 / PCR 11 and
 * user_data. Throws on any signature/chain failure. `now` defaults to the real
 * clock (production freshness); tests may pass a time inside the leaf's window.
 */
export async function verifyNitroTpmDocument(
	docBytes: Uint8Array,
	now: Date = new Date()
): Promise<NitroTpmResult> {
	const { decode, encode } = await import('cbor-x')

	// COSE_Sign1 = [protected(bstr), unprotected, payload(bstr), signature(bstr)]
	const cose = decode(Buffer.from(docBytes)) as unknown[]
	if(!Array.isArray(cose) || cose.length !== 4) {
		throw new Error('NitroTPM: not a COSE_Sign1 4-array')
	}

	const protectedHdr = Buffer.from(cose[0] as Uint8Array)
	const payload = Buffer.from(cose[2] as Uint8Array)
	const signature = Buffer.from(cose[3] as Uint8Array)

	const doc = decode(payload) as Record<string, unknown>
	const leaf = new X509Certificate(Buffer.from(doc.certificate as Uint8Array))
	const cabundle = (doc.cabundle as Uint8Array[]).map(
		der => new X509Certificate(Buffer.from(der))
	)
	const userData = Buffer.from(doc.user_data as Uint8Array)

	const pcr8 = pcrValue(doc.nitrotpm_pcrs, 8)
	const pcr11 = pcrValue(doc.nitrotpm_pcrs, 11)
	if(!pcr8 || !pcr11) {
		throw new Error('NitroTPM: doc missing PCR 8 / PCR 11')
	}

	verifyChainToNitroRoot(leaf, cabundle, now)

	// COSE_Sign1 ToBeSigned = ["Signature1", protected, external_aad h'', payload]
	const tbs = encode(['Signature1', protectedHdr, Buffer.alloc(0), payload])
	if(signature.length !== 96) {
		throw new Error(`NitroTPM: COSE signature is ${signature.length} bytes, want 96 (ES384)`)
	}

	// signature is raw r||s (IEEE P1363); node hashes tbs with SHA-384 then verifies P-384
	const ok = nodeVerify(
		'sha384',
		tbs,
		{ key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
		signature
	)
	if(!ok) {
		throw new Error('NitroTPM: COSE_Sign1 ES384 signature invalid')
	}

	return { pcr8, pcr11, userData }
}
