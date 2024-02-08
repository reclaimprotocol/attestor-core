import { ethers } from 'ethers'
import { ServerError, Status } from 'nice-grpc-common'
import CONTRACTS_CONFIG from './config.json'
import { Reclaim, Reclaim__factory as ReclaimFactory } from './types'

const existingContractsMap: { [chain: string]: Reclaim } = { }

/**
 * get the Reclaim beacon contract for the given chain
 * @param chainId hex-encoded string prefixed by 0x
 */
export function getContract(chainKey: string) {
	if(!existingContractsMap[chainKey]) {
		const contractData = CONTRACTS_CONFIG[chainKey as keyof typeof CONTRACTS_CONFIG]
		if(!contractData) {
			throw new ServerError(Status.INVALID_ARGUMENT, `Unsupported chain: "${chainKey}"`)
		}

		const rpcProvider = new ethers.providers.JsonRpcProvider(contractData.rpcUrl)
		existingContractsMap[chainKey] = ReclaimFactory.connect(
			contractData.address,
			rpcProvider,
		)
	}

	return existingContractsMap[chainKey]
}