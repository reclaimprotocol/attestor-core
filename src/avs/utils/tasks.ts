import { EventLog, getBytes, type Wallet } from 'ethers'

import type { IReclaimServiceManager, NewTaskCreatedEvent } from '#src/avs/contracts/ReclaimServiceManager.ts'
import { getContracts } from '#src/avs/utils/contracts.ts'

type CreateClaimWithoutOwner = Omit<IReclaimServiceManager.ClaimRequestStruct, 'owner'>

type CreateNewClaimRequestOnChainOpts = {
	request: CreateClaimWithoutOwner
	payer: Wallet
	chainId?: string
} & ({
	owner: Wallet
} | {
	/**
	 * Address of the owner of the claim
	 */
	owner: string
	requestSignature?: string | Uint8Array
})

export async function createNewClaimRequestOnChain({
	request,
	payer,
	chainId,
	...rest
}: CreateNewClaimRequestOnChainOpts) {
	const contracts = getContracts(chainId)
	const contract = contracts.contract.connect(payer)
	const ownerAddress = typeof rest.owner === 'string'
		? rest.owner
		: rest.owner.address
	const fullRequest: IReclaimServiceManager.ClaimRequestStruct = {
		...request,
		owner: ownerAddress
	}
	const signature = await getSignature()
	const task = await contract.createNewTask(fullRequest, signature || '0x00')
	const rslt = await task.wait()
	const logs = rslt?.logs ?? []
	const eventLogs = logs.filter((log): log is EventLog => log instanceof EventLog)
	// check task created event was emitted
	const ev = eventLogs[0]
	const arg = ev?.args as unknown as NewTaskCreatedEvent.OutputObject

	return { task: arg, tx: rslt }

	function getSignature() {
		if(ownerAddress.toLowerCase() === payer.address.toLowerCase()) {
			return
		}

		if('requestSignature' in rest) {
			return rest.requestSignature
		}

		if(typeof rest.owner !== 'object') {
			throw new Error(
				'Owner wallet must be provided or'
				+ ' requestSignature must be provided'
			)
		}

		return signClaimRequest(fullRequest, rest.owner, chainId)
	}
}

export async function signClaimRequest(
	request: IReclaimServiceManager.ClaimRequestStruct,
	owner: Wallet,
	chainId?: string
) {
	const contract = getContracts(chainId).contract
	const encoded = await contract.encodeClaimRequest(request)
	const strSig = await owner.signMessage(getBytes(encoded))
	return getBytes(strSig)
}