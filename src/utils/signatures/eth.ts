import { computeAddress, getBytes, hexlify, keccak256, recoverAddress, SigningKey, toUtf8Bytes, Wallet } from 'ethers'

import type { ServiceSignatureProvider } from '#src/types/index.ts'

const EIP191_PREFIX = toUtf8Bytes('\x19Ethereum Signed Message:\n')

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
		// Equivalent to wallet.signMessage(bytes): same EIP-191 digest, same signature
		// bytes. Avoids ethers' ~60x heap blow-up on multi-MB payloads (e.g. claim
		// bundles carrying many STWO proofs) by hashing the message in place instead
		// of going through hex/string round-trips internally.
		const sig = wallet.signingKey.sign(eip191Digest(data))
		return getBytes(sig.serialized)
	},
	async verify(data, signature, addressBytes) {
		const address = typeof addressBytes === 'string'
			? addressBytes
			: hexlify(addressBytes)
		const signatureHex = typeof signature === 'string' ? signature : hexlify(signature)
		// Mirror of sign(): recover from the same EIP-191 digest instead of calling
		// ethers' verifyMessage(data, sig), which has the same ~60x amplification.
		const signerAddress = recoverAddress(eip191Digest(data), signatureHex)
		return signerAddress.toLowerCase() === address.toLowerCase()
	}
}

function getEthWallet(privateKey: string) {
	if(!privateKey) {
		throw new Error('Private key missing')
	}

	return new Wallet(privateKey)
}

function eip191Digest(data: Uint8Array | string): string {
	const bytes = typeof data === 'string' ? toUtf8Bytes(data) : data
	const lenBytes = toUtf8Bytes(String(bytes.length))
	const merged = new Uint8Array(
		EIP191_PREFIX.length + lenBytes.length + bytes.length
	)
	merged.set(EIP191_PREFIX, 0)
	merged.set(lenBytes, EIP191_PREFIX.length)
	merged.set(bytes, EIP191_PREFIX.length + lenBytes.length)
	return keccak256(merged)
}
