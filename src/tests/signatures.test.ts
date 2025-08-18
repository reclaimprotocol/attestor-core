import { utils, Wallet } from 'ethers'
import assert from 'node:assert'
import { describe, it } from 'node:test'

import { ServiceSignatureType } from '#src/proto/api.ts'
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

			const addr = algorithm.getAddress(utils.arrayify(alice.publicKey))
			let res = await algorithm.verify(data, signature, addr)

			assert.ok(res)
			res = await algorithm.verify(data, utils.hexlify(signature), addr)

			assert.ok(res)
		})
	})
}