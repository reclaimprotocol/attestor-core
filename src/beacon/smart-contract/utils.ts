import { ethers } from 'ethers'
import { WitnessError } from '../../utils'
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
			throw WitnessError
				.badRequest(`Unsupported chain: "${chainKey}"`)
		}

		const rpcProvider = new ethers.providers.JsonRpcProvider(contractData.rpcUrl)
		existingContractsMap[chainKey] = ReclaimFactory.connect(
			contractData.address,
			rpcProvider,
		)
	}

	return existingContractsMap[chainKey]
}