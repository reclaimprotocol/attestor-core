import { utils, Wallet } from 'ethers'
import { ServiceSignatureType } from 'src/proto/api'
import { SIGNATURES } from 'src/utils/signatures'

const ALGS = [
	{
		title: 'ETH',
		algorithm: SIGNATURES[ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH]
	}
]

describe.each(ALGS)('$title Signatures', ({ algorithm }) => {

	it('should sign & verify', async() => {

		const alice = Wallet.createRandom()

		const data = Buffer.from('{"a":"123","b":123}', 'utf8')
		const signature = await algorithm.sign(
			data,
			alice.privateKey,
		)

		const addr = algorithm.getAddress(utils.arrayify(alice.publicKey))
		let res = await algorithm.verify(data, signature, addr)

		expect(res).toBeTruthy()
		res = await algorithm.verify(data, utils.hexlify(signature), addr)

		expect(res).toBeTruthy()
	})
})