import { ethers } from 'ethers'
import { avsDirectoryABI } from '../abis/avsDirectoryABI'
import { delegationABI } from '../abis/delegationABI'
import { registryABI } from '../abis/registryABI'
import { CHAIN_CONFIGS, PRIVATE_KEY, SELECTED_CHAIN_ID } from '../config'
import { ReclaimServiceManager__factory } from '../contracts'
import { ChainConfig } from '../types'

type Contracts = ReturnType<typeof initialiseContracts>

const configs: { [key: string]: Contracts } = {}

/**
 * get the contracts for the given chain ID
 */
export function getContracts(chainId = SELECTED_CHAIN_ID) {
	const config = CHAIN_CONFIGS[chainId]
	if(!config) {
		throw new Error('No config found for chain ID: ' + chainId)
	}

	configs[chainId] ||= initialiseContracts(config)
	return configs[chainId]
}

function initialiseContracts({
	rpcUrl,
	stakeRegistryAddress,
	avsDirectoryAddress,
	contractAddress,
	delegationManagerAddress,
}: ChainConfig) {
	const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
	const wallet = new ethers.Wallet(PRIVATE_KEY, provider)

	return {
		provider,
		wallet,
		delegationManager: new ethers.Contract(
			delegationManagerAddress,
			delegationABI,
			wallet
		),
		// eslint-disable-next-line camelcase
		contract: ReclaimServiceManager__factory.connect(
			contractAddress,
			wallet
		),
		registryContract: new ethers.Contract(
			stakeRegistryAddress,
			registryABI,
			wallet
		),
		avsDirectory: new ethers.Contract(
			avsDirectoryAddress,
			avsDirectoryABI,
			wallet
		),
	}
}