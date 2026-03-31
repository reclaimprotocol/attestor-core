import { computeAddress, getBytes, hexlify, SigningKey, verifyMessage, Wallet } from 'ethers'

import type { ServiceSignatureProvider } from '#src/types/index.ts'

export const ETH_SIGNATURE_PROVIDER: ServiceSignatureProvider = {
	getPublicKey(privateKey) {
		const pub = SigningKey.computePublicKey(privateKey, true)
		return getBytes(pub)
	},
	getAddress(publicKey) {
		// computeAddress in v6 expects hex string
		const pubKeyHex = typeof publicKey === 'string' ? publicKey : hexlify(publicKey)
		return computeAddress(pubKeyHex).toLowerCase()
	},
	async sign(data, privateKey) {
		const wallet = getEthWallet(privateKey)
		const signature = await wallet.signMessage(data)
		return getBytes(signature)
	},
	async verify(data, signature, addressBytes) {
		const address = typeof addressBytes === 'string'
			? addressBytes
			: hexlify(addressBytes)
		// verifyMessage in v6 expects SignatureLike (hex string)
		const signatureHex = typeof signature === 'string' ? signature : hexlify(signature)
		const signerAddress = verifyMessage(data, signatureHex)
		return signerAddress.toLowerCase() === address.toLowerCase()
	}
}

function getEthWallet(privateKey: string) {
	if(!privateKey) {
		throw new Error('Private key missing')
	}

	return new Wallet(privateKey)
}