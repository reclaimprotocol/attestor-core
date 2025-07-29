import { IReclaimServiceManager, TaskCompletedEventObject } from 'src/avs/contracts/ReclaimServiceManager.ts'
import { getContracts } from 'src/avs/utils/contracts.ts'
import { RPCHandler } from 'src/types/index.ts'
import { AttestorError, ethersStructToPlainObject } from 'src/utils/index.ts'
import { getEnvVariable } from 'src/utils/env.ts'

const ACCEPT_CLAIM_PAYMENT_REQUESTS = getEnvVariable('ACCEPT_CLAIM_PAYMENT_REQUESTS') === '1'

export const completeClaimOnChain: RPCHandler<'completeClaimOnChain'> = async(
	{ chainId: chainIdNum, taskIndex, completedTaskJson },
) => {
	if(!ACCEPT_CLAIM_PAYMENT_REQUESTS) {
		throw new AttestorError(
			'ERROR_PAYMENT_REFUSED',
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

	const plainObj = ethersStructToPlainObject(obj)

	return {
		txHash: rslt.transactionHash,
		taskCompletedObjectJson: JSON.stringify(plainObj)
	}
}