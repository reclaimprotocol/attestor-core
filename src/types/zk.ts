import { EncryptionAlgorithm, OPRFOperator, ZKEngine, ZKOperator } from '@reclaimprotocol/zk-symmetric-crypto'
import { TOPRFPayload } from 'src/proto/api'

export type ZKOperators = { [E in EncryptionAlgorithm]?: ZKOperator }

export type OPRFOperators = { [E in EncryptionAlgorithm]?: OPRFOperator }

export type PrepareZKProofsBaseOpts = {
	/** get ZK operator for specified algorithm */
	zkOperators?: ZKOperators

	oprfOperators?: OPRFOperators
	/**
	 * max number of ZK proofs to generate concurrently
	 * @default 10
	 */
	zkProofConcurrency?: number
	zkEngine?: ZKEngine
}

export type TOPRFProofParams = TOPRFPayload & {
	mask: Uint8Array
	plaintext: Uint8Array
}