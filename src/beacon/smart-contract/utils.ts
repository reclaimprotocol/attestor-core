import { ethers } from 'ethers'
import { ServerError, Status } from 'nice-grpc-common'
import CONTRACTS_CONFIG from './config.json'
import { Reclaim, Reclaim__factory as ReclaimFactory } from './types'

const existingContractsMap: { [chain: string]: Reclaim } = { }

export function getContract(chainId: number) {
	const chainKey = `0x${chainId.toString(16)}`
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