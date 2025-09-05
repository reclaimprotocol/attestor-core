import type { EncryptionAlgorithm, OPRFOperator, ZKEngine, ZKOperator } from '@reclaimprotocol/zk-symmetric-crypto'

import type { ExecuteOPRFOpts, ExecuteZKOpts } from '#src/external-rpc/types.ts'
import { rpcRequest } from '#src/external-rpc/utils.ts'
import { logger, makeDefaultZkOperator } from '#src/utils/index.ts'

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
export function makeExternalRpcZkOperator(
	algorithm: EncryptionAlgorithm,
	zkEngine: ZKEngine = 'snarkjs'
): ZKOperator {
	return {
		async generateWitness(input) {
			const operator = await makeDefaultZkOperator(algorithm, zkEngine, logger)
			return operator.generateWitness(input)
		},
		groth16Prove(input) {
			return callFnZk({ fn: 'groth16Prove', args: [input] })
		},
		groth16Verify(publicSignals, proof) {
			return callFnZk({ fn: 'groth16Verify', args: [publicSignals, proof] })
		},
	}
}


function callFnZk(request: ExecuteZKOpts) {
	return rpcRequest({ type: 'executeZkFunctionV3', request })
}


/**
 * The goal of this RPC operator is if the attestor client
 * is running in a WebView, it can call the native
 * application to perform the OPRF operations
 */
export function makeExternalRpcOprfOperator(
	algorithm: EncryptionAlgorithm,
	zkEngine: ZKEngine = 'snarkjs'
): OPRFOperator {
	return {
		async generateWitness(input) {
			const operator = await makeDefaultZkOperator(algorithm, zkEngine, logger)
			return operator.generateWitness(input)
		},
		groth16Prove(input) {
			return callFnOprf({ fn: 'groth16Prove', args: [input] })
		},
		groth16Verify(publicSignals, proof) {
			return callFnOprf({ fn: 'groth16Verify', args: [publicSignals, proof] })
		},
		generateThresholdKeys(total, threshold) {
			return callFnOprf({ fn: 'generateThresholdKeys', args: [total, threshold] })
		},
		generateOPRFRequestData(data, domainSeparator) {
			return callFnOprf({ fn: 'generateOPRFRequestData', args: [data, domainSeparator] })
		},
		finaliseOPRF(serverPublicKey, request, responses) {
			return callFnOprf({ fn: 'finaliseOPRF', args: [serverPublicKey, request, responses] })
		},
		evaluateOPRF(serverPrivateKey, request) {
			return callFnOprf({ fn: 'evaluateOPRF', args: [serverPrivateKey, request] })
		},
	}
}

function callFnOprf(request: ExecuteOPRFOpts) {
	return rpcRequest({ type: 'executeOprfFunctionV3', request })
}