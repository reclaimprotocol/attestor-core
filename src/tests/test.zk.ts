import { ZKOperator } from '@reclaimprotocol/circom-chacha20'
import { concatenateUint8Arrays } from '@reclaimprotocol/tls'
import { createCipheriv } from 'crypto'
import { FinaliseSessionRequest_Block as BlockToReveal } from '../proto/api'
import {
	getBlocksToReveal,
	makeDefaultZkOperator,
	prepareZkProofs,
	uint8ArrayToStr,
	verifyZKBlock
} from '../utils'

type ServerBlock = BlockToReveal & {
	plaintext: Uint8Array
	ciphertext: Uint8Array
}

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

	it('should generate ZK proof for some ciphertext', async() => {
		const key = Buffer.alloc(32, 0)
		const iv = Buffer.alloc(12, 0)
		const vectors = [
			{
				plaintextStrs: [
					'My cool API secret is "',
					'my name jeff',
					'". Please don\'t reveal it'
				],
				redactions: [
					{ fromIndex: 23, toIndex: 35 }
				]
			},
			{
				plaintextStrs: [
					`lorem ipsum dolor sit amet, consectetur adipiscing elit,
				sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
				Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris
				nisi ut aliquip ex ea commodo consequat.`,
					`Duis aute irure dolor in reprehenderit in voluptate velit esse
					cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat
					cupidatat non proident, sunt in culpa qui officia deserunt mollit anim
					id est laborum`,
				],
				redactions: [
					{ fromIndex: 5, toIndex: 15 },
				]
			}
		]

		for(const { plaintextStrs, redactions } of vectors) {
			const plaintexts = plaintextStrs.map(str => Buffer.from(str))
			const blocks = plaintexts.map((plaintext): ServerBlock => {
				const cipher = createCipheriv('chacha20-poly1305', key, iv, { authTagLength: 16 })
				cipher.setAAD(Buffer.alloc(AUTH_TAG_BYTE_LENGTH, 1), { plaintextLength: plaintext.length })
				const ciphertext = concatenateUint8Arrays(
					[
						cipher.update(plaintext),
						cipher.final()
					]
				)

				return {
					authTag: cipher.getAuthTag(),
					key: new Uint8Array(),
					iv: new Uint8Array(),
					directReveal: {	key, iv },
					zkReveal: undefined,
					plaintext,
					ciphertext
				}
			})

			const proofs = await prepareZkProofs({
				blocks,
				zkOperator:operator,
				redact: () => redactions,
			})

			if(proofs === 'all') {
				fail('should not return "all"')
			}

			for(const { block, redactedPlaintext } of proofs) {
				const x = await verifyZKBlock(
					{
						ciphertext: block.ciphertext,
						zkReveal: block.zkReveal!,
						operator
					},
				)

				expect(redactedPlaintext).toEqual(
					x.redactedPlaintext
				)
			}
		}
	})
})