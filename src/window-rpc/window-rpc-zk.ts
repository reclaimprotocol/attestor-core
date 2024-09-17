import { EncryptionAlgorithm, ZKOperator } from '@reclaimprotocol/circom-symmetric-crypto'
import { base64 } from 'ethers/lib/utils'
import { ZKEngine } from 'src/types'
import { logger, makeDefaultZkOperator } from 'src/utils'
import { CommunicationBridge, WindowRPCAppClient } from 'src/window-rpc/types'
import { generateRpcRequestId } from 'src/window-rpc/utils'

export const ALL_ENC_ALGORITHMS: EncryptionAlgorithm[] = [
	'aes-256-ctr',
	'aes-128-ctr',
	'chacha20',
]

/**
 * The goal of this RPC operator is if the attestor client
 * is running in a WebView, it can call the native
 * application to perform the ZK operations
 */
export function makeWindowRpcZkOperator(
	algorithm: EncryptionAlgorithm,
	bridge: CommunicationBridge,
	zkEngine: ZKEngine = 'snarkJS'
): ZKOperator {
	return {
		async generateWitness(input) {
			const operator = await makeDefaultZkOperator(algorithm, zkEngine, logger)
			return operator.generateWitness(input)
		},
		groth16Prove(input) {
			const id = generateRpcRequestId()
			const waitForRes = waitForResponse('zkProve', id, bridge)

			bridge.send({
				type: 'zkProve',
				id,
				request: {
					algorithm,
					input: { witnessB64: base64.encode(input) },
				},
				module: 'attestor-core'
			})

			return waitForRes
		},
		groth16Verify(publicSignals, proof) {
			const id = generateRpcRequestId()
			const waitForRes = waitForResponse('zkVerify', id, bridge)

			bridge.send({
				type: 'zkVerify',
				id,
				request: {
					algorithm,
					publicSignals,
					proof,
				},
				module: 'attestor-core'
			})

			return waitForRes
		},
	}


}

export function waitForResponse<T extends keyof WindowRPCAppClient>(
	type: T,
	requestId: string,
	bridge: CommunicationBridge
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