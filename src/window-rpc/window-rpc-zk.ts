import { EncryptionAlgorithm, OPRFOperator, ZKEngine, ZKOperator } from '@reclaimprotocol/zk-symmetric-crypto'
import { logger, makeDefaultZkOperator } from 'src/utils'
import { CommunicationBridge, ExecuteOPRFOpts, ExecuteZKOpts } from 'src/window-rpc/types'
import { generateRpcRequestId, waitForResponse } from 'src/window-rpc/utils'

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
	zkEngine: ZKEngine = 'snarkjs'
): ZKOperator {
	return {
		async generateWitness(input) {
			const operator = await makeDefaultZkOperator(algorithm, zkEngine, logger)
			return operator.generateWitness(input)
		},
		groth16Prove(input) {
			return callFn({ fn: 'groth16Prove', args: [input] })
		},
		groth16Verify(publicSignals, proof) {
			return callFn({ fn: 'groth16Verify', args: [publicSignals, proof] })
		},
	}

	function callFn(opts: ExecuteZKOpts) {
		const id = generateRpcRequestId()
		const waitForRes = waitForResponse(
			'executeZkFunctionV3', id, bridge
		)

		bridge.send({
			type: 'executeZkFunctionV3',
			id,
			request: opts,
			module: 'attestor-core'
		})

		return waitForRes
	}
}


/**
 * The goal of this RPC operator is if the attestor client
 * is running in a WebView, it can call the native
 * application to perform the OPRF operations
 */
export function makeWindowRpcOprfOperator(
	algorithm: EncryptionAlgorithm,
	bridge: CommunicationBridge,
	zkEngine: ZKEngine = 'snarkjs'
): OPRFOperator {
	return {
		async generateWitness(input) {
			const operator = await makeDefaultZkOperator(algorithm, zkEngine, logger)
			return operator.generateWitness(input)
		},
		groth16Prove(input) {
			return callFn({ fn: 'groth16Prove', args: [input] })
		},
		groth16Verify(publicSignals, proof) {
			return callFn({ fn: 'groth16Verify', args: [publicSignals, proof] })
		},
		generateThresholdKeys(total, threshold) {
			return callFn({ fn: 'generateThresholdKeys', args: [total, threshold] })
		},
		generateOPRFRequestData(data, domainSeparator) {
			return callFn({ fn: 'generateOPRFRequestData', args: [data, domainSeparator] })
		},
		finaliseOPRF(serverPublicKey, request, responses) {
			return callFn({ fn: 'finaliseOPRF', args: [serverPublicKey, request, responses] })
		},
		evaluateOPRF(serverPrivateKey, request) {
			return callFn({ fn: 'evaluateOPRF', args: [serverPrivateKey, request] })
		},
	}

	function callFn(opts: ExecuteOPRFOpts) {
		const id = generateRpcRequestId()
		const waitForRes = waitForResponse(
			'executeOprfFunctionV3', id, bridge
		)

		bridge.send({
			type: 'executeOprfFunctionV3',
			id,
			request: opts,
			module: 'attestor-core'
		})

		return waitForRes
	}
}