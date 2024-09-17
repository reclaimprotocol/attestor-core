import { IReclaimServiceManager } from 'src/avs/contracts/ReclaimServiceManager'
import { getContracts } from 'src/avs/utils/contracts'
import { createNewClaimRequestOnChain } from 'src/avs/utils/tasks'
import { RPCHandler } from 'src/types'
import { AttestorError, ethersStructToPlainObject } from 'src/utils'
import { getEnvVariable } from 'src/utils/env'

const ACCEPT_CLAIM_PAYMENT_REQUESTS = getEnvVariable('ACCEPT_CLAIM_PAYMENT_REQUESTS') === '1'

export const createClaimOnChain: RPCHandler<'createClaimOnChain'> = async(
	{ chainId: chainIdNum, jsonCreateClaimRequest, requestSignature },
) => {
	if(!ACCEPT_CLAIM_PAYMENT_REQUESTS) {
		throw new AttestorError(
			'ERROR_PAYMENT_REFUSED',
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
		payer: wallet!,
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