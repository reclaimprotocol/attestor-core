import { utils, Wallet } from 'ethers'
import { computeAddress, computePublicKey } from 'ethers/lib/utils'
import { ServiceSignatureProvider } from 'src/types'

export const ETH_SIGNATURE_PROVIDER: ServiceSignatureProvider = {
	getPublicKey(privateKey) {
		const pub = computePublicKey(privateKey, true)
		return utils.arrayify(pub)
	},
	getAddress(publicKey) {
		return computeAddress(publicKey).toLowerCase()
	},
	async sign(data, privateKey) {
		const wallet = getEthWallet(privateKey)
		const signature = await wallet.signMessage(data)
		return utils.arrayify(signature)
	},
	async verify(data, signature, addressBytes) {
		const address = typeof addressBytes === 'string'
			? addressBytes
			: utils.hexlify(addressBytes)
		const signerAddress = utils.verifyMessage(data, signature)
		return signerAddress.toLowerCase() === address.toLowerCase()
	}
}

function getEthWallet(privateKey: string) {
	if(!privateKey) {
		throw new Error('Private key missing')
	}

	return new Wallet(privateKey)
}