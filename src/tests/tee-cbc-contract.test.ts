import assert from 'node:assert'
import { describe, it } from 'node:test'

import bs58 from 'bs58'
import { Wallet } from 'ethers'

import {
	BodyType,
	CertificateInfo,
	KOutputPayload,
	OPRFOutput,
	OPRFVerificationData,
	SignedMessage,
	TLS12CBCKOutput,
	TLS12CBCRecordMode,
	TLS12CBCSessionBinding,
	TLS12CBCTOutput,
	TOutputPayload,
	VerificationBundle,
} from '#src/proto/tee-bundle.ts'
import { validateAndCombineOprfResults } from '#src/server/handlers/claimTeeBundle.ts'
import { validateTeeTranscriptContract } from '#src/server/utils/tee-cbc-contract.ts'
import { MAX_TEE_OPRF_MPC_OUTPUTS, verifyOprfMpcOutputs } from '#src/server/utils/tee-oprf-mpc-verification.ts'
import { reconstructTlsTranscript } from '#src/server/utils/tee-transcript-reconstruction.ts'
import {
	MAX_TEE_SIGNED_BODY_SIZE,
	MAX_TEE_VERIFICATION_BUNDLE_SIZE,
	type TeeBundleData,
	verifyTeeBundle,
} from '#src/server/utils/tee-verification.ts'
import { logger } from '#src/utils/logger.ts'
import { ETH_SIGNATURE_PROVIDER } from '#src/utils/signatures/eth.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('TEE TLS 1.2 CBC contract', () => {
	it('accepts a complete CBC contract and reconstructs signed redactions', async() => {
		const request = encoder.encode('GET / HTTP/1.1\r\nHost: example.com\r\nAuthorization: SECRET\r\n\r\n')
		const requestSecret = findBytes(request, encoder.encode('SECRET'))
		const response = encoder.encode('HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nSECRET')
		const responseSecret = findBytes(response, encoder.encode('SECRET'))
		const { bundle, kPayload, tPayload } = makeCbcContract(request, response, requestSecret, responseSecret)

		assert.equal(validateTeeTranscriptContract(bundle, kPayload, tPayload), 'tls12-cbc')
		const transcript = await reconstructTlsTranscript(
			makeBundleData(kPayload, tPayload, 'tls12-cbc'),
			logger,
		)
		assert.equal(
			decoder.decode(transcript.revealedRequest),
			'GET / HTTP/1.1\r\nHost: example.com\r\nAuthorization: ******\r\n\r\n',
		)
		assert.equal(
			decoder.decode(transcript.reconstructedResponse),
			'HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\n******',
		)
	})

	it('accepts an encoded and signed standalone CBC bundle', async() => {
		const contract = makeCbcContract(
			encoder.encode('GET /signed HTTP/1.1\r\n\r\n'),
			encoder.encode('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK'),
			0,
			0,
		)
		const teekWallet = Wallet.createRandom()
		const teetWallet = Wallet.createRandom()
		const kBody = KOutputPayload.encode(contract.kPayload).finish()
		const tBody = TOutputPayload.encode(contract.tPayload).finish()
		contract.bundle.teekSigned = SignedMessage.create({
			bodyType: BodyType.BODY_TYPE_K_OUTPUT,
			body: kBody,
			ethAddress: encoder.encode(teekWallet.address),
			signature: await ETH_SIGNATURE_PROVIDER.sign(kBody, teekWallet.privateKey),
		})
		contract.bundle.teetSigned = SignedMessage.create({
			bodyType: BodyType.BODY_TYPE_T_OUTPUT,
			body: tBody,
			ethAddress: encoder.encode(teetWallet.address),
			signature: await ETH_SIGNATURE_PROVIDER.sign(tBody, teetWallet.privateKey),
		})

		const previousStandalone = process.env.TEE_STANDALONE
		process.env.TEE_STANDALONE = 'true'
		try {
			const verified = await verifyTeeBundle(VerificationBundle.encode(contract.bundle).finish(), logger)
			assert.equal(verified.protocolMode, 'tls12-cbc')
			assert.equal(verified.teeSessionId, 'cbc-session')
		} finally {
			if(previousStandalone === undefined) {
				delete process.env.TEE_STANDALONE
			} else {
				process.env.TEE_STANDALONE = previousStandalone
			}
		}
	})

	it('rejects a one-sided or mixed CBC contract', () => {
		const { bundle, kPayload, tPayload } = makeCbcContract(
			encoder.encode('request'),
			encoder.encode('response'),
			0,
			0,
		)
		tPayload.tls12Cbc = undefined
		assert.throws(
			() => validateTeeTranscriptContract(bundle, kPayload, tPayload),
			/CBC contract must be present in both TEE payloads/,
		)

		const mixed = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 0, 0)
		mixed.kPayload.consolidatedResponseKeystream = new Uint8Array([1])
		assert.throws(
			() => validateTeeTranscriptContract(mixed.bundle, mixed.kPayload, mixed.tPayload),
			/mixes legacy split-AEAD fields/,
		)
	})

	it('rejects binding, digest, range, and record-length tampering', () => {
		const bindingMismatch = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 0, 0)
		bindingMismatch.tPayload.tls12Cbc!.binding!.sessionBinding[0] ^= 1
		assert.throws(
			() => validateTeeTranscriptContract(bindingMismatch.bundle, bindingMismatch.kPayload, bindingMismatch.tPayload),
			/session binding mismatch/,
		)

		const badDigest = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 0, 0)
		badDigest.kPayload.tls12Cbc!.requestRecordsSha256 = new Uint8Array(31)
		assert.throws(
			() => validateTeeTranscriptContract(badDigest.bundle, badDigest.kPayload, badDigest.tPayload),
			/request record digest must be 32 bytes/,
		)

		const badRange = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 0, 0)
		badRange.tPayload.tls12Cbc!.responseRedactionRanges = [{ start: 7, length: 2 }]
		assert.throws(
			() => validateTeeTranscriptContract(badRange.bundle, badRange.kPayload, badRange.tPayload),
			/response redaction range 0 is out of bounds/,
		)

		const badLengths = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 0, 0)
		badLengths.tPayload.tls12Cbc!.plaintextRecordLengths = [7]
		assert.throws(
			() => validateTeeTranscriptContract(badLengths.bundle, badLengths.kPayload, badLengths.tPayload),
			/record lengths do not match/,
		)
	})

	it('accepts all twelve supported AES-CBC cipher suites', () => {
		const suites = [
			0xc009, 0xc013, 0xc00a, 0xc014, 0xc023, 0xc027,
			0xc024, 0xc028, 0x002f, 0x0035, 0x003c, 0x003d,
		]
		for(const cipherSuite of suites) {
			const contract = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 99, 99)
			contract.kPayload.tls12Cbc!.binding!.cipherSuite = cipherSuite
			contract.tPayload.tls12Cbc!.binding!.cipherSuite = cipherSuite
			assert.equal(
				validateTeeTranscriptContract(contract.bundle, contract.kPayload, contract.tPayload),
				'tls12-cbc',
			)
		}
	})

	it('rejects legacy ZK TOPRF data for CBC', () => {
		const contract = makeCbcContract(encoder.encode('request'), encoder.encode('response'), 0, 0)
		contract.bundle.oprfVerifications = [OPRFVerificationData.create({
			streamPos: 0,
			streamLength: 1,
			publicSignalsJson: new Uint8Array([1]),
		})]
		assert.throws(
			() => validateTeeTranscriptContract(contract.bundle, contract.kPayload, contract.tPayload),
			/does not support legacy ZK TOPRF/,
		)
	})

	it('uses matching CBC MPC OPRF outputs and rejects out-of-bounds positions', async() => {
		const request = encoder.encode('GET / HTTP/1.1\r\n\r\n')
		const response = encoder.encode('HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nSECRET')
		const secretStart = findBytes(response, encoder.encode('SECRET'))
		const contract = makeCbcContract(request, response, 0, secretStart)
		const hashOutput = new Uint8Array(32).fill(9)
		const output = OPRFOutput.create({ tlsStart: secretStart, tlsLength: 6, hashOutput })
		contract.kPayload.oprfOutputs = [output]
		contract.tPayload.oprfOutputs = [OPRFOutput.create({
			...output,
			hashOutput: new Uint8Array(hashOutput),
		})]

		const verified = verifyOprfMpcOutputs(contract.kPayload, contract.tPayload, logger)
		const transcript = await reconstructTlsTranscript(
			makeBundleData(contract.kPayload, contract.tPayload, 'tls12-cbc'),
			logger,
			verified,
		)
		assert.equal(
			decoder.decode(transcript.reconstructedResponse),
			`HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\n${bs58.encode(hashOutput)}`,
		)

		contract.kPayload.oprfOutputs[0].tlsStart = response.length
		contract.tPayload.oprfOutputs[0].tlsStart = response.length
		assert.throws(
			() => verifyOprfMpcOutputs(contract.kPayload, contract.tPayload, logger),
			/exceeds authenticated response length/,
		)
	})

	it('caps and de-duplicates MPC OPRF ranges', () => {
		const response = new Uint8Array(128)
		const contract = makeCbcContract(encoder.encode('request'), response, 99, 999)
		const makeOutput = (position: number) => OPRFOutput.create({
			tlsStart: position,
			tlsLength: 1,
			hashOutput: new Uint8Array(32).fill(position + 1),
		})
		contract.kPayload.oprfOutputs = Array.from({ length: MAX_TEE_OPRF_MPC_OUTPUTS }, (_, i) => makeOutput(i))
		contract.tPayload.oprfOutputs = contract.kPayload.oprfOutputs.map(output => OPRFOutput.create({
			...output,
			hashOutput: new Uint8Array(output.hashOutput),
		}))
		assert.equal(verifyOprfMpcOutputs(contract.kPayload, contract.tPayload, logger).length, MAX_TEE_OPRF_MPC_OUTPUTS)

		contract.kPayload.oprfOutputs.push(makeOutput(MAX_TEE_OPRF_MPC_OUTPUTS))
		contract.tPayload.oprfOutputs.push(makeOutput(MAX_TEE_OPRF_MPC_OUTPUTS))
		assert.throws(
			() => verifyOprfMpcOutputs(contract.kPayload, contract.tPayload, logger),
			/Too many OPRF MPC outputs/,
		)

		contract.kPayload.oprfOutputs = [makeOutput(3), makeOutput(3)]
		contract.tPayload.oprfOutputs = [makeOutput(3), makeOutput(3)]
		assert.throws(
			() => verifyOprfMpcOutputs(contract.kPayload, contract.tPayload, logger),
			/OPRF MPC ranges overlap/,
		)
	})

	it('rejects OPRF ranges over chunk framing', async() => {
		const header = 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'
		const response = encoder.encode(`${header}3\r\nabc\r\n5\r\ndefgh\r\n0\r\n\r\n`)
		const contract = makeCbcContract(encoder.encode('request'), response, 99, 999)
		const framingPosition = encoder.encode(header).length
		const output = OPRFOutput.create({
			tlsStart: framingPosition,
			tlsLength: 1,
			hashOutput: new Uint8Array(32).fill(7),
		})
		contract.kPayload.oprfOutputs = [output]
		contract.tPayload.oprfOutputs = [OPRFOutput.create({ ...output, hashOutput: new Uint8Array(output.hashOutput) })]
		const verified = verifyOprfMpcOutputs(contract.kPayload, contract.tPayload, logger)

		await assert.rejects(
			reconstructTlsTranscript(makeBundleData(contract.kPayload, contract.tPayload, 'tls12-cbc'), logger, verified),
			/not wholly contained in HTTP chunk data/,
		)
	})

	it('rejects overlapping OPRF sources before reconstruction', () => {
		assert.throws(
			() => validateAndCombineOprfResults(
				[{ position: 4, length: 2, output: new Uint8Array(32) }],
				[{ position: 4, length: 2, output: new Uint8Array(32), isMPC: true }],
				logger,
			),
			/Overlapping OPRF ranges/,
		)
	})

	it('rejects oversized TEE verification bundles before protobuf decoding', async() => {
		await assert.rejects(
			verifyTeeBundle(new Uint8Array(MAX_TEE_VERIFICATION_BUNDLE_SIZE + 1), logger),
			/exceeds the maximum size/,
		)
	})

	it('rejects oversized signed bodies before nested protobuf decoding', async() => {
		const bundle = VerificationBundle.create({
			teekSigned: SignedMessage.create({
				bodyType: BodyType.BODY_TYPE_K_OUTPUT,
				body: new Uint8Array(MAX_TEE_SIGNED_BODY_SIZE + 1),
				ethAddress: new Uint8Array([1]),
				signature: new Uint8Array([1]),
			}),
			teetSigned: SignedMessage.create({
				bodyType: BodyType.BODY_TYPE_T_OUTPUT,
				body: new Uint8Array([1]),
				ethAddress: new Uint8Array([1]),
				signature: new Uint8Array([1]),
			}),
		})
		await assert.rejects(
			verifyTeeBundle(VerificationBundle.encode(bundle).finish(), logger),
			/signed body exceeds the maximum size/,
		)
	})

	it('preserves the legacy split-AEAD reconstruction path', async() => {
		const request = encoder.encode('GET /legacy HTTP/1.1\r\n\r\n')
		const response = encoder.encode('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
		const keystream = new Uint8Array(response.length).fill(0x55)
		const ciphertext = response.map((value, index) => value ^ keystream[index])
		const kPayload = KOutputPayload.create({
			redactedRequest: request,
			consolidatedResponseKeystream: keystream,
			certificateInfo: testCertificate(),
			sessionId: 'legacy-session',
		})
		const tPayload = TOutputPayload.create({
			consolidatedResponseCiphertext: ciphertext,
			sessionId: 'legacy-session',
		})
		const bundle = VerificationBundle.create({})

		assert.equal(validateTeeTranscriptContract(bundle, kPayload, tPayload), 'split-aead')
		const transcript = await reconstructTlsTranscript(
			makeBundleData(kPayload, tPayload, 'split-aead'),
			logger,
		)
		assert.deepEqual(transcript.revealedRequest, request)
		assert.deepEqual(transcript.reconstructedResponse, response)
	})
})

function makeCbcContract(
	request: Uint8Array,
	response: Uint8Array,
	requestSecret: number,
	responseSecret: number,
) {
	const binding = TLS12CBCSessionBinding.create({
		contractVersion: 1,
		cipherSuite: 0xc013,
		recordMode: TLS12CBCRecordMode.TLS12_CBC_RECORD_MODE_MAC_THEN_ENCRYPT,
		extendedMasterSecret: true,
		sessionBinding: new Uint8Array(32).fill(7),
	})
	const requestRanges = request.length >= requestSecret + 6
		? [{ start: requestSecret, length: 6, type: 'sensitive' }]
		: []
	const responseRanges = response.length >= responseSecret + 6
		? [{ start: responseSecret, length: 6 }]
		: []
	const kPayload = KOutputPayload.create({
		certificateInfo: testCertificate(),
		timestampMs: Date.now(),
		sessionId: 'cbc-session',
		tls12Cbc: TLS12CBCKOutput.create({
			binding,
			authenticatedRedactedRequest: request,
			requestRecordsSha256: new Uint8Array(32).fill(1),
			requestRedactionRanges: requestRanges,
		}),
	})
	const tPayload = TOutputPayload.create({
		timestampMs: Date.now(),
		sessionId: 'cbc-session',
		tls12Cbc: TLS12CBCTOutput.create({
			binding: TLS12CBCSessionBinding.create({
				...binding,
				sessionBinding: new Uint8Array(binding.sessionBinding),
			}),
			authenticatedRedactedResponse: response,
			responseRecordsSha256: new Uint8Array(32).fill(2),
			responseRedactionRanges: responseRanges,
			plaintextRecordLengths: [response.length],
		}),
	})
	return { bundle: VerificationBundle.create({}), kPayload, tPayload }
}

function makeBundleData(
	kOutputPayload: KOutputPayload,
	tOutputPayload: TOutputPayload,
	protocolMode: TeeBundleData['protocolMode'],
): TeeBundleData {
	const emptyK = SignedMessage.create({ bodyType: BodyType.BODY_TYPE_K_OUTPUT })
	const emptyT = SignedMessage.create({ bodyType: BodyType.BODY_TYPE_T_OUTPUT })
	return {
		teekSigned: emptyK,
		teetSigned: emptyT,
		kOutputPayload,
		tOutputPayload,
		teekPcr0: 'test-k',
		teetPcr0: 'test-t',
		teeSessionId: kOutputPayload.sessionId,
		protocolMode,
	}
}

function testCertificate() {
	return CertificateInfo.create({
		commonName: 'example.com',
		dnsNames: ['example.com'],
		notBeforeUnix: 1,
		notAfterUnix: 4_000_000_000,
	})
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
	for(let start = 0; start <= haystack.length - needle.length; start++) {
		let match = true
		for(let offset = 0; offset < needle.length; offset++) {
			if(haystack[start + offset] !== needle[offset]) {
				match = false
				break
			}
		}
		if(match) {
			return start
		}
	}
	throw new Error('test fixture substring not found')
}
