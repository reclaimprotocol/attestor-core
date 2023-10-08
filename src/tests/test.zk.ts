import { crypto, encryptWrappedRecord, SUPPORTED_CIPHER_SUITE_MAP } from '@reclaimprotocol/tls'
import { CompleteTLSPacket } from '../types'
import {
	getBlocksToReveal,
	logger,
	makeZkProofGenerator,
	redactSlices,
	uint8ArrayToStr,
	verifyZkPacket
} from '../utils'

const ZK_CIPHER_SUITES: (keyof typeof SUPPORTED_CIPHER_SUITE_MAP)[] = [
	'TLS_CHACHA20_POLY1305_SHA256',
	'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384'
]

jest.setTimeout(60_000) // 60s

describe('ZK Tests', () => {

	it('should correctly redact blocks', () => {
		const vectors = [
			{
				input: [
					'hell',
					'o world'
				],
				output: [
					'h***',
					'* world'
				],
				redactions: [
					{ fromIndex: 1, toIndex: 5 }
				]
			},
			{
				input: [
					'hell',
					'o world'
				],
				output: [
					// first block is completely
					// redacted, so it won't be included
					'* world'
				],
				redactions: [
					{ fromIndex: 0, toIndex: 5 }
				]
			},
			{
				input: [
					'hello',
					'how',
					'do',
					'you',
					'do'
				],
				output: [
					'he**o',
					'd*',
					'y*u',
					'do'
				],
				redactions: [
					{ fromIndex: 2, toIndex: 4 },
					{ fromIndex: 5, toIndex: 8 },
					{ fromIndex: 9, toIndex: 10 },
					{ fromIndex: 11, toIndex: 12 }
				]
			}
		]

		for(const { input, output, redactions } of vectors) {
			const realOutput = getBlocksToReveal(
				input.map(i => ({ plaintext: Buffer.from(i) })),
				() => redactions
			)
			if(realOutput === 'all') {
				fail('should not return "all"')
				continue
			}

			expect(realOutput).toHaveLength(output.length)
			for(let i = 0; i < output.length; i++) {
				expect(
					uint8ArrayToStr(realOutput[i].redactedPlaintext)
				).toEqual(output[i])
			}
		}
	})

	it.each(ZK_CIPHER_SUITES)('[%s] should generate ZK proof for some ciphertext', async(cipherSuite) => {
		const key = Buffer.alloc(32, 0)
		const {
			ivLength: fixedIvLength,
		} = SUPPORTED_CIPHER_SUITE_MAP[cipherSuite]
		const fixedIv = Buffer.alloc(fixedIvLength, 0)
		const alg = cipherSuite.includes('CHACHA20')
			? 'CHACHA20-POLY1305'
			: 'AES-256-GCM'
		const encKey = await crypto.importKey(alg, key)
		const vectors = [
			{
				plaintext: 'My cool API secret is "my name jeff". Please don\'t reveal it',
				redactions: [
					{ fromIndex: 23, toIndex: 35 }
				]
			},
			{
				plaintext: `lorem ipsum dolor sit amet, consectetur adipiscing elit,
				sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
				Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris
				nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse
				cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat
				cupidatat non proident, sunt in culpa qui officia deserunt mollit anim
				id est laborum`,
				redactions: [
					{ fromIndex: 5, toIndex: 15 },
				]
			}
		]

		const proofGenerator = makeZkProofGenerator({ logger })
		for(const { plaintext, redactions } of vectors) {
			const plaintextArr = Buffer.from(plaintext)
			const redactedPlaintext = redactSlices(plaintextArr, redactions)
			// ensure redaction fn kinda works at least
			expect(redactedPlaintext).not.toEqual(plaintextArr)

			const { ciphertext, iv } = await encryptWrappedRecord(
				plaintextArr,
				{
					key: encKey,
					iv: fixedIv,
					recordNumber: 0,
					recordHeaderOpts: {
						type: 'WRAPPED_RECORD'
					},
					cipherSuite,
					version: cipherSuite.includes('ECDHE_')
						? 'TLS1_2'
						: 'TLS1_3',
				}
			)

			const packet: CompleteTLSPacket = {
				packet: {
					header: Buffer.alloc(0),
					content: ciphertext,
				},
				ctx: {
					type: 'ciphertext',
					encKey,
					iv,
					recordNumber: 0,
					plaintext: plaintextArr,
					ciphertext,
					fixedIv: new Uint8Array(0),
				},
				reveal: {
					type: 'zk',
					redactedPlaintext,
				},
				sender: 1,
				index: 0,
			}

			const zkReveal = await proofGenerator.generateProof(
				packet,
				cipherSuite
			)

			const x = await verifyZkPacket(
				{
					ciphertext,
					zkReveal,
					logger,
					cipherSuite,
				},
			)

			expect(redactedPlaintext).toEqual(
				x.redactedPlaintext
			)
		}
	})
})