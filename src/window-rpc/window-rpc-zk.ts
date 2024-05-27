import { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import { base64 } from 'ethers/lib/utils'
import { logger, makeDefaultZkOperator } from '../utils'
import { CommunicationBridge, WindowRPCAppClient } from './types'
import { generateRpcRequestId } from './utils'

export const ALL_ENC_ALGORITHMS: EncryptionAlgorithm[] = [
	'aes-256-ctr',
	'aes-128-ctr',
	'chacha20',
]

/**
 * The goal of this RPC operator is if the witness
 * is running in a WebView, it can call the native
 * application to perform the ZK operations
 */
export function makeWindowRpcZkOperator(
	algorithm: EncryptionAlgorithm,
	bridge: CommunicationBridge
): ZKOperator {
	return {
		async generateWitness(input) {
			const operator = await makeDefaultZkOperator(algorithm, logger)
			return operator.generateWitness(input)
		},
		groth16Prove(input) {
			const id = generateRpcRequestId()
			const waitForRes = waitForResponse('zkProve', id)

			bridge.send({
				type: 'zkProve',
				id,
				request: {
					algorithm,
					input: { witnessB64: base64.encode(input) },
				},
				module: 'witness-sdk'
			})

			return waitForRes
		},
		groth16Verify(publicSignals, proof) {
			const id = generateRpcRequestId()
			const waitForRes = waitForResponse('zkVerify', id)

			bridge.send({
				type: 'zkVerify',
				id,
				request: {
					algorithm,
					publicSignals,
					proof,
				},
				module: 'witness-sdk'
			})

			return waitForRes
		},
	}

	function waitForResponse<T extends keyof WindowRPCAppClient>(
		type: T,
		requestId: string
	) {
		type R = Awaited<ReturnType<WindowRPCAppClient[T]>>
		const returnType = `${type}Done` as const
		return new Promise<R>((resolve, reject) => {
			const cancel = bridge.onMessage(msg => {
				if(msg.id === requestId) {
					if(msg.type === 'error') {
						reject(new Error(msg.data.message))
					} else if(msg.type === returnType) {
						resolve(msg.response as R)
					}

					cancel()
				}
			})
		})
	}
}