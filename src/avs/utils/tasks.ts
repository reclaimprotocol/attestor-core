import { ethers, type Wallet } from 'ethers'
import type { IReclaimServiceManager, NewTaskCreatedEventObject } from 'src/avs/contracts/ReclaimServiceManager'
import { getContracts } from 'src/avs/utils/contracts'

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
	const events = rslt.events
	// check task created event was emitted
	const ev = events?.[0]
	const arg = ev?.args as unknown as NewTaskCreatedEventObject

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
	const strSig = await owner.signMessage(ethers.utils.arrayify(encoded))
	return ethers.utils.arrayify(strSig)
}