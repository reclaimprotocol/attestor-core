import { IReclaimServiceManager } from '../../avs/contracts/ReclaimServiceManager'
import { getContracts } from '../../avs/utils/contracts'
import { createNewClaimRequestOnChain } from '../../avs/utils/tasks'
import { RPCHandler } from '../../types'
import { ethersStructToPlainObject, WitnessError } from '../../utils'
import { getEnvVariable } from '../../utils/env'

const ACCEPT_CLAIM_PAYMENT_REQUESTS = getEnvVariable('ACCEPT_CLAIM_PAYMENT_REQUESTS') === '1'

export const createClaimOnChain: RPCHandler<'createClaimOnChain'> = async(
	{ chainId: chainIdNum, jsonCreateClaimRequest, requestSignature },
) => {
	if(!ACCEPT_CLAIM_PAYMENT_REQUESTS) {
		throw new WitnessError(
			'WITNESS_ERROR_PAYMENT_REFUSED',
			'Payment requests are not accepted at this time'
		)
	}

	const chainId = chainIdNum.toString()
	const { wallet } = getContracts(chainId.toString())
	const request: IReclaimServiceManager.ClaimRequestStruct
		= JSON.parse(jsonCreateClaimRequest)
	const { task, tx } = await createNewClaimRequestOnChain({
		request,
		owner: request.owner,
		payer: wallet,
		chainId,
		requestSignature: requestSignature
	})

	const plainTask = ethersStructToPlainObject(task)

	return {
		txHash: tx.transactionHash,
		taskIndex: task.taskIndex,
		jsonTask: JSON.stringify(plainTask)
	}
}