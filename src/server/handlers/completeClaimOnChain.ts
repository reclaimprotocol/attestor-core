import { IReclaimServiceManager, TaskCompletedEventObject } from '../../avs/contracts/ReclaimServiceManager'
import { getContracts } from '../../avs/utils/contracts'
import { RPCHandler } from '../../types'
import { WitnessError } from '../../utils'
import { getEnvVariable } from '../../utils/env'

const ACCEPT_CLAIM_PAYMENT_REQUESTS = getEnvVariable('ACCEPT_CLAIM_PAYMENT_REQUESTS') === '1'

export const completeClaimOnChain: RPCHandler<'completeClaimOnChain'> = async(
	{ chainId: chainIdNum, taskIndex, completedTaskJson },
) => {
	if(!ACCEPT_CLAIM_PAYMENT_REQUESTS) {
		throw new WitnessError(
			'WITNESS_ERROR_PAYMENT_REFUSED',
			'Payment requests are not accepted at this time'
		)
	}

	const chainId = chainIdNum.toString()
	const { contract } = getContracts(chainId.toString())
	const task: IReclaimServiceManager.CompletedTaskStruct
		= JSON.parse(completedTaskJson)
	const tx = await contract.taskCompleted(task, taskIndex)
	const rslt = await tx.wait()

	// check task created event was emitted
	const ev = rslt.events?.[0]
	const obj = ev?.args as unknown as TaskCompletedEventObject

	return {
		txHash: rslt.transactionHash,
		taskCompletedObjectJson: JSON.stringify(obj)
	}
}