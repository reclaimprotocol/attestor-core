import { ethers, type Wallet } from 'ethers'
import type { IReclaimServiceManager, NewTaskCreatedEventObject } from '../contracts/ReclaimServiceManager'
import { getContracts } from './contracts'

type CreateClaimWithoutOwner = Omit<IReclaimServiceManager.ClaimRequestStruct, 'owner'>

type CreateNewClaimRequestOnChainOpts = {
	request: CreateClaimWithoutOwner
	payer: Wallet
	chainId?: string
} & ({
	owner: Wallet
} | {
	owner: string
	requestSignature?: string
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
	const events = rslt.events
	// check task created event was emitted
	const ev = events?.[0]
	const arg = ev?.args as unknown as NewTaskCreatedEventObject

	return arg

	async function getSignature() {
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

		const encoded = await contract.encodeClaimRequest(fullRequest)
		return rest.owner.signMessage(ethers.utils.arrayify(encoded))
	}
}