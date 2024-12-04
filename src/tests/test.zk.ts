import { CipherSuite, crypto, encryptWrappedRecord, strToUint8Array, SUPPORTED_CIPHER_SUITE_MAP } from '@reclaimprotocol/tls'
import { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import { MessageReveal_ZKProof as ZKProof } from 'src/proto/api'
import { CompleteTLSPacket, RedactedOrHashedArraySlice } from 'src/types'
import {
	getBlocksToReveal,
	logger,
	makeZkProofGenerator,
	redactSlices,
	uint8ArrayToStr,
	verifyZkPacket
} from 'src/utils'

const ZK_CIPHER_SUITES: CipherSuite[] = [
	'TLS_CHACHA20_POLY1305_SHA256',
	'TLS_AES_128_GCM_SHA256',
	'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
]

const ZK_ENGINES: ZKEngine[] = [
	'gnark',
	'snarkjs'
]

type RedactionTestVector = {
	input: string[]
	output: string[]
	redactions: RedactedOrHashedArraySlice[]
}

jest.setTimeout(90_000) // 90s

describe('Redaction Tests', () => {

	it('should correctly redact blocks', async() => {
		const vectors: RedactionTestVector[] = [
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
			const realOutput = await getBlocksToReveal(
				input.map(i => ({ plaintext: Buffer.from(i) })),
				() => redactions,
				() => {
					throw new Error('should not call this')
				}
			)
			if(realOutput === 'all') {
				fail('should not return "all"')
				continue
			}

			expect(realOutput).toHaveLength(output.length)
			for(const [i, element] of output.entries()) {
				expect(
					uint8ArrayToStr(realOutput[i].redactedPlaintext)
				).toEqual(element)
			}
		}
	})

	it('should correctly hash blocks', async() => {
		const nullifer = strToUint8Array('abcdefg')
		const base64Nullifier = Buffer.from(nullifer).toString('base64')
		const vectors: RedactionTestVector[] = [
			{
				input: [
					'hell',
					'o world'
				],
				output: [
					'h' + base64Nullifier.slice(0, 3),
					base64Nullifier.slice(3, 4) + ' world'
				],
				redactions: [
					{ fromIndex: 1, toIndex: 5, hash: 'oprf' }
				]
			},
			{
				input: [
					'hell',
					'o world'
				],
				output: [
					base64Nullifier.slice(0, 4),
					base64Nullifier.slice(4, 5) + ' world'
				],
				redactions: [
					{ fromIndex: 0, toIndex: 5, hash: 'oprf' }
				]
			},
		]

		for(const { input, output, redactions } of vectors) {
			const realOutput = await getBlocksToReveal(
				input.map(i => ({ plaintext: Buffer.from(i) })),
				() => redactions,
				async() => ({
					dataLocation: undefined,
					nullifier: nullifer,
					responses: [],
					mask: strToUint8Array('mask')
				})
			)
			if(realOutput === 'all') {
				fail('should not return "all"')
			}

			expect(realOutput).toHaveLength(output.length)
			for(const [i, element] of output.entries()) {
				expect(
					uint8ArrayToStr(realOutput[i].redactedPlaintext)
				).toEqual(element)
			}
		}
	})
})

describe.each(ZK_CIPHER_SUITES)('[%s] should generate ZK proof for some ciphertext', (cipherSuite) => {
	describe.each(ZK_ENGINES)('[%s]', (zkEngine) => {
		it(zkEngine + '-' + cipherSuite, async() => {
			const alg = cipherSuite.includes('CHACHA20')
				? 'CHACHA20-POLY1305'
				: (
					cipherSuite.includes('AES_256_GCM')
						? 'AES-256-GCM'
						: 'AES-128-GCM'
				)
			const keylength = alg === 'AES-128-GCM' ? 16 : 32
			const key = Buffer.alloc(keylength, 0)
			key[0] = 1
			key[3] = 4
			const {
				ivLength: fixedIvLength,
			} = SUPPORTED_CIPHER_SUITE_MAP[cipherSuite]
			const fixedIv = Buffer.alloc(fixedIvLength, 0)
			fixedIv[0] = 1
			fixedIv[3] = 4

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

			const proofGenerator = await makeZkProofGenerator({
				logger,
				cipherSuite,
				zkEngine: zkEngine
			})
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
						recordNumber: 1234,
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
					type: 'ciphertext',
					encKey,
					iv,
					recordNumber: 1234,
					plaintext: plaintextArr,
					ciphertext,
					fixedIv: fixedIv,
					data: ciphertext
				}

				let proofs: ZKProof[] | undefined
				await proofGenerator.addPacketToProve(
					packet,
					{
						type: 'zk',
						redactedPlaintext,
					},
					p => proofs = p
				)
				await proofGenerator.generateProofs()
				const x = await verifyZkPacket(
					{
						ciphertext,
						zkReveal: { proofs: proofs! },
						logger,
						cipherSuite,
						zkEngine: zkEngine,
						recordNumber: 1234,
						iv:fixedIv
					},
				)

				expect(redactedPlaintext).toEqual(
					x.redactedPlaintext
				)
			}
		})
	})
})