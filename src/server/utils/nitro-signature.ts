import { createPublicKey, verify } from 'node:crypto'

import { Decoder, encode } from 'cbor-x'

/** Verify the ES384 COSE_Sign1 signature used by Nitro attestation documents. */
export function verifyNitroSignature(cose: unknown[], publicKeyDer: Buffer): void {
	if(cose.length !== 4) {
		throw new Error('Expected a COSE_Sign1 array with 4 elements')
	}

	const [protectedHeader, unprotectedHeader, payload, signature] = cose
	if(!Buffer.isBuffer(protectedHeader) || !Buffer.isBuffer(payload)
		|| !Buffer.isBuffer(signature) || signature.length !== 96) {
		throw new Error('Invalid ES384 COSE_Sign1 fields')
	}

	const headers = protectedHeader.length
		? new Decoder({ mapsAsObjects: false }).decode(protectedHeader)
		: new Map()
	const unprotectedAlgorithm = unprotectedHeader instanceof Map
		? unprotectedHeader.get(1)
		: unprotectedHeader?.[1]
	if(!(headers instanceof Map) || (headers.get(1) ?? unprotectedAlgorithm) !== -35) {
		throw new Error('Expected the ES384 COSE algorithm')
	}

	const key = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' })
	if(key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'secp384r1') {
		throw new Error('Expected a P-384 public key')
	}

	const signedData = encode(['Signature1', protectedHeader, Buffer.alloc(0), payload])
	if(!verify('sha384', signedData, { key, dsaEncoding: 'ieee-p1363' }, signature)) {
		throw new Error('Invalid COSE_Sign1 signature')
	}
}
