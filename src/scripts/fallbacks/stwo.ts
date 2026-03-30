/**
 * Browser fallback for stwo - loads from window.s2circuits
 * The s2circuits.js script must be loaded before this runs
 */

import type {
	EncryptionAlgorithm,
	FileFetch,
	Logger,
	MakeZKOperatorOpts,
	ZKOperator,
	ZKProofInput
} from '@reclaimprotocol/zk-symmetric-crypto'

// Browser-native base64 utilities
const Base64 = {
	fromUint8Array(arr: Uint8Array): string {
		let binary = ''
		for(const element of arr) {
			binary += String.fromCharCode(element)
		}

		return btoa(binary)
	},
	toUint8Array(str: string): Uint8Array {
		const binary = atob(str)
		const arr = new Uint8Array(binary.length)
		for(let i = 0; i < binary.length; i++) {
			arr[i] = binary.charCodeAt(i)
		}

		return arr
	}
}

type StwoWitnessData = {
	algorithm: EncryptionAlgorithm
	key: string // base64
	nonce: string // base64
	counter: number
	plaintext: string // base64
	ciphertext: string // base64
}

type ProveResult = {
	success?: boolean
	error?: string
	proof?: string
	blocks?: number
	algorithm?: string
	proof_size_bytes?: number
}

type VerifyResult = {
	valid?: boolean
	error?: string
	algorithm?: string
}

// Get s2circuits from window (loaded via script tag)
function getS2Circuits() {
	const s2 = (window as unknown as { s2circuits?: unknown })['s2circuits'] as {
		initSync?: (options: { module: Uint8Array }) => void
		generate_chacha20_proof?: (key: Uint8Array, nonce: Uint8Array, counter: number, plaintext: Uint8Array, ciphertext: Uint8Array) => string
		generate_aes128_ctr_proof?: (key: Uint8Array, nonce: Uint8Array, counter: number, plaintext: Uint8Array, ciphertext: Uint8Array) => string
		generate_aes256_ctr_proof?: (key: Uint8Array, nonce: Uint8Array, counter: number, plaintext: Uint8Array, ciphertext: Uint8Array) => string
		verify_chacha20_proof?: (proof: string, nonce: Uint8Array, counter: number, plaintext: Uint8Array, ciphertext: Uint8Array) => string
		verify_aes_ctr_proof?: (proof: string, nonce: Uint8Array, counter: number, plaintext: Uint8Array, ciphertext: Uint8Array) => string
	} | undefined

	if(!s2) {
		throw new Error('s2circuits not loaded. Make sure s2circuits.js is loaded before using stwo.')
	}

	return s2
}

function assertU32Counter(counter: number): void {
	if(!Number.isInteger(counter) || counter < 0 || counter > 0xFFFFFFFF) {
		throw new RangeError('counter must be a uint32 integer (0 to 4294967295)')
	}
}

let wasmInitialized = false
let initPromise: Promise<void> | undefined

async function ensureWasmInitialized(fetcher: FileFetch, logger?: Logger): Promise<void> {
	if(wasmInitialized) {
		return
	}

	if(initPromise) {
		return initPromise
	}

	initPromise = (async() => {
		try {
			const s2 = getS2Circuits()
			const wasmBytes = await fetcher.fetch('stwo', 's2circuits_bg.wasm', logger)
			s2.initSync!({ module: wasmBytes })
			wasmInitialized = true
		} catch(err) {
			initPromise = undefined
			throw err
		}
	})()

	return initPromise
}

function serializeWitness(algorithm: EncryptionAlgorithm, input: ZKProofInput): Uint8Array {
	if(!input.noncesAndCounters?.length) {
		throw new Error('noncesAndCounters must be a non-empty array')
	}

	const { noncesAndCounters: [{ nonce, counter }] } = input
	assertU32Counter(counter)
	// Note: In the JS library, 'in' is ciphertext and 'out' is plaintext
	// Stwo expects (key, nonce, counter, plaintext, ciphertext)
	const data: StwoWitnessData = {
		algorithm,
		key: Base64.fromUint8Array(input.key),
		nonce: Base64.fromUint8Array(nonce),
		counter,
		plaintext: Base64.fromUint8Array(input.out), // out = decrypted plaintext
		ciphertext: Base64.fromUint8Array(input.in), // in = encrypted ciphertext
	}
	return new TextEncoder().encode(JSON.stringify(data))
}

function deserializeWitness(witness: Uint8Array): StwoWitnessData {
	const json = new TextDecoder().decode(witness)
	return JSON.parse(json)
}

export function makeStwoZkOperator({
	algorithm,
	fetcher,
}: MakeZKOperatorOpts<object>): ZKOperator {
	return {
		generateWitness(input) {
			return serializeWitness(algorithm, input)
		},

		async groth16Prove(witness, logger) {
			await ensureWasmInitialized(fetcher, logger)
			const s2 = getS2Circuits()
			const data = deserializeWitness(witness)

			const key = Base64.toUint8Array(data.key)
			const nonce = Base64.toUint8Array(data.nonce)
			const plaintext = Base64.toUint8Array(data.plaintext)
			const ciphertext = Base64.toUint8Array(data.ciphertext)

			let resultJson: string
			switch (data.algorithm) {
			case 'chacha20':
				resultJson = s2.generate_chacha20_proof!(key, nonce, data.counter, plaintext, ciphertext)
				break
			case 'aes-128-ctr':
				resultJson = s2.generate_aes128_ctr_proof!(key, nonce, data.counter, plaintext, ciphertext)
				break
			case 'aes-256-ctr':
				resultJson = s2.generate_aes256_ctr_proof!(key, nonce, data.counter, plaintext, ciphertext)
				break
			default:
				throw new Error(`Unsupported algorithm: ${data.algorithm}`)
			}

			const result: ProveResult = JSON.parse(resultJson)
			if(result.error) {
				throw new Error(`Stwo proof generation failed: ${result.error}`)
			}

			if(!result.proof) {
				throw new Error('Stwo proof generation failed: no proof returned')
			}

			return { proof: result.proof }
		},

		async groth16Verify(publicSignals, proof, logger) {
			await ensureWasmInitialized(fetcher, logger)
			const s2 = getS2Circuits()

			const expectedNonce = publicSignals.noncesAndCounters[0]?.nonce
			const expectedCounter = publicSignals.noncesAndCounters[0]?.counter
			const expectedCiphertext = publicSignals.in
			const expectedPlaintext = publicSignals.out

			if(!expectedNonce || expectedCounter === undefined) {
				logger?.warn('Invalid publicSignals: missing nonce or counter')
				return false
			}

			assertU32Counter(expectedCounter)

			const proofStr = typeof proof === 'string'
				? proof
				: new TextDecoder().decode(proof)

			let resultJson: string
			if(algorithm === 'chacha20') {
				resultJson = s2.verify_chacha20_proof!(
					proofStr, expectedNonce, expectedCounter, expectedPlaintext, expectedCiphertext
				)
			} else {
				resultJson = s2.verify_aes_ctr_proof!(
					proofStr, expectedNonce, expectedCounter, expectedPlaintext, expectedCiphertext
				)
			}

			const result: VerifyResult = JSON.parse(resultJson)
			if(result.error) {
				logger?.warn({ error: result.error }, 'Stwo STARK verification failed')
				return false
			}

			return result.valid === true
		},

		release() {
			wasmInitialized = false
			initPromise = undefined
		}
	}
}
