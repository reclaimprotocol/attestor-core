import { EventLog } from 'ethers'

import type { IReclaimServiceManager, TaskCompletedEvent } from '#src/avs/contracts/ReclaimServiceManager.ts'
import { getContracts } from '#src/avs/utils/contracts.ts'
import type { RPCHandler } from '#src/types/index.ts'
import { getEnvVariable } from '#src/utils/env.ts'
import { AttestorError, ethersStructToPlainObject } from '#src/utils/index.ts'

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
	const logs = rslt?.logs ?? []
	const eventLogs = logs.filter((log): log is EventLog => log instanceof EventLog)
	const obj = eventLogs[0]?.args as unknown as TaskCompletedEvent.OutputObject

	const plainObj = ethersStructToPlainObject(obj)

	return {
		txHash: rslt?.hash ?? '',
		taskCompletedObjectJson: JSON.stringify(plainObj)
	}
}