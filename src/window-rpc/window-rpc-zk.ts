import { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import { CommunicationBridge } from './types'
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
			const requestId = generateRpcRequestId()
			const waitForRes = waitForResponse<any, 'zkProveDone'>(
				'zkProveDone',
				requestId
			)

			bridge.send({
				type: 'zkProve',
				requestId,
				data: {
					algorithm,
					input: input as {},
				}
			})

			return waitForRes
		},
		groth16Verify(publicSignals, proof) {
			const requestId = generateRpcRequestId()
			const waitForRes = waitForResponse<boolean, 'zkVerifyDone'>(
				'zkVerifyDone',
				requestId
			)

			bridge.send({
				type: 'zkVerify',
				requestId,
				data: {
					algorithm,
					publicSignals,
					proof,
				}
			})

			return waitForRes
		},
	}

	function waitForResponse<R, T extends 'zkProveDone' | 'zkVerifyDone'>(
		type: T,
		requestId: string
	) {
		return new Promise<R>((resolve, reject) => {
			const cancel = bridge.onMessage(msg => {
				if(
					msg.type === type
					&& msg.requestId === requestId
				) {
					if('error' in msg.result) {
						reject(new Error(msg.result.error))
					} else {
						// @ts-ignore
						resolve(msg.result.output)
					}

					cancel()
				}
			})
		})
	}
}