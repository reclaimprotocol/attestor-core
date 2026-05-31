import assert from 'node:assert'
import { describe, it } from 'node:test'

import { getBytes, hexlify, Wallet } from 'ethers'

import { ServiceSignatureType } from '#src/proto/api.ts'
import { ETH_SIGNATURE_PROVIDER } from '#src/utils/signatures/eth.ts'
import { SIGNATURES } from '#src/utils/signatures/index.ts'

const ALGS = [
	{
		title: 'ETH',
		algorithm: SIGNATURES[ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH]
	}
]

for(const { algorithm } of ALGS) {
	describe(`${algorithm} Signatures`, () => {

		it('should sign & verify', async() => {

			const alice = Wallet.createRandom()

			const data = Buffer.from('{"a":"123","b":123}', 'utf8')
			const signature = await algorithm.sign(
				data,
				alice.privateKey,
			)

			const addr = algorithm.getAddress(getBytes(alice.publicKey))
			let res = await algorithm.verify(data, signature, addr)

			assert.ok(res)
			res = await algorithm.verify(data, hexlify(signature), addr)

			assert.ok(res)
		})
	})
}

describe('ETH signature parity with wallet.signMessage', () => {
	it('produces identical bytes to wallet.signMessage for Uint8Array input', async() => {
		const wallet = Wallet.createRandom()
		const data = new Uint8Array(1024)
		for(let i = 0; i < data.length; i++) {
			data[i] = (i * 31) & 0xff
		}

		const ours = await ETH_SIGNATURE_PROVIDER.sign(data, wallet.privateKey)
		const reference = getBytes(await wallet.signMessage(data))

		assert.deepStrictEqual(ours, reference)
	})

	it('produces identical bytes to wallet.signMessage for string input', async() => {
		const wallet = Wallet.createRandom()
		const data = '{"a":"123","b":123,"c":"unicode: π Ω ✓"}'

		const ours = await ETH_SIGNATURE_PROVIDER.sign(data, wallet.privateKey)
		const reference = getBytes(await wallet.signMessage(data))

		assert.deepStrictEqual(ours, reference)
	})

	it('signs & verifies multi-megabyte payloads without ethers memory blow-up', async() => {
		// 8 MB payload. ethers' wallet.signMessage / verifyMessage allocate
		// ~480 MB of JS heap at this size (60x amplification via hex/string
		// round-trips). The in-place EIP-191 path should stay well under that
		// — we cap each heap delta at 80 MB (10x input size) to leave headroom
		// for V8 fragmentation while still catching a regression to the old
		// behaviour.
		const wallet = Wallet.createRandom()
		const data = new Uint8Array(8 * 1024 * 1024)
		for(let i = 0; i < 4096; i++) {
			data[i] = (i * 17) & 0xff
		}

		if(global.gc) {
			global.gc()
		}

		const heapBeforeSign = process.memoryUsage().heapUsed
		const signature = await ETH_SIGNATURE_PROVIDER.sign(data, wallet.privateKey)
		const heapAfterSign = process.memoryUsage().heapUsed
		const signHeapDeltaMb = (heapAfterSign - heapBeforeSign) / 1024 / 1024

		assert.strictEqual(signature.length, 65, 'expected 65-byte ECDSA sig')
		assert.ok(
			signHeapDeltaMb < 80,
			`heap grew by ${signHeapDeltaMb.toFixed(1)} MB while signing 8 MB; `
				+ 'expected < 80 MB. The sign() implementation may have regressed '
				+ 'to ethers signMessage which amplifies input size ~60x in memory.'
		)

		if(global.gc) {
			global.gc()
		}

		const heapBeforeVerify = process.memoryUsage().heapUsed
		const ok = await ETH_SIGNATURE_PROVIDER.verify(
			data, signature, wallet.address.toLowerCase()
		)
		const heapAfterVerify = process.memoryUsage().heapUsed
		const verifyHeapDeltaMb = (heapAfterVerify - heapBeforeVerify) / 1024 / 1024

		assert.ok(ok, 'signature must verify against the signing wallet')
		assert.ok(
			verifyHeapDeltaMb < 80,
			`heap grew by ${verifyHeapDeltaMb.toFixed(1)} MB while verifying 8 MB; `
				+ 'expected < 80 MB. The verify() implementation may have regressed '
				+ 'to ethers verifyMessage which amplifies input size ~60x in memory.'
		)
	})
})
