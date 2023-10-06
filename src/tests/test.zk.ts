import { ZKOperator } from '@reclaimprotocol/circom-chacha20'
import { concatenateUint8Arrays, crypto } from '@reclaimprotocol/tls'
import { createCipheriv } from 'crypto'
import { CompleteTLSPacket } from '../types'
import {
	getBlocksToReveal,
	getPureCiphertext,
	logger,
	makeDefaultZkOperator,
	makeZkProofGenerator,
	redactSlices,
	uint8ArrayToStr,
	verifyZkPacket
} from '../utils'

const AUTH_TAG_BYTE_LENGTH = 16

jest.setTimeout(60_000) // 60s

describe('ZK', () => {

	let operator: ZKOperator
	beforeAll(async() => {
		operator = await makeDefaultZkOperator()
	})

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

	it('should generate chacha ZK proof for some ciphertext', async() => {
		const key = Buffer.alloc(32, 0)
		const iv = Buffer.alloc(12, 0)
		const encKey = await crypto.importKey(
			'CHACHA20-POLY1305',
			key,
		)
		const cipherSuite = 'TLS_CHACHA20_POLY1305_SHA256'
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

			const cipher = createCipheriv('chacha20-poly1305', key, iv, { authTagLength: 16 })
			cipher.setAAD(Buffer.alloc(AUTH_TAG_BYTE_LENGTH, 1), { plaintextLength: plaintext.length })
			const ciphertext = concatenateUint8Arrays(
				[
					cipher.update(plaintext),
					cipher.final(),
					cipher.getAuthTag()
				]
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
					ciphertext: getPureCiphertext(ciphertext, cipherSuite),
					zkReveal,
					operator,
					logger
				},
			)

			expect(redactedPlaintext).toEqual(
				x.redactedPlaintext
			)
		}
	})
})