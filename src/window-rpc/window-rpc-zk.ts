import { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import { CommunicationBridge, RPCAppClient } from './types'
import { generateRpcRequestId } from './utils'

export const ALL_ENC_ALGORITHMS: EncryptionAlgorithm[] = [
	'aes-256-ctr',
	'chacha20'
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
		groth16FullProve(input) {
			const id = generateRpcRequestId()
			const waitForRes = waitForResponse('zkProve', id)

			bridge.send({
				type: 'zkProve',
				id,
				request: {
					algorithm,
					input: input as {},
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

	function waitForResponse<T extends keyof RPCAppClient>(
		type: T,
		requestId: string
	) {
		type R = Awaited<ReturnType<RPCAppClient[T]>>
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