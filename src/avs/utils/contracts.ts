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
export function getContracts(chainId = SELECTED_CHAIN_ID!) {
	const config = CHAIN_CONFIGS[chainId]
	if(!config) {
		throw new Error(`No config found for chain ID: ${chainId}`)
	}

	configs[chainId] ||= initialiseContracts(config)
	return configs[chainId]
}

export function initialiseContracts(
	{
		rpcUrl,
		stakeRegistryAddress,
		avsDirectoryAddress,
		contractAddress,
		delegationManagerAddress,
	}: ChainConfig,
	privateKey: string | undefined = PRIVATE_KEY
) {
	const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
	const wallet = privateKey
		? new ethers.Wallet(privateKey, provider)
		: undefined

	return {
		provider,
		wallet,
		delegationManager: new ethers.Contract(
			delegationManagerAddress,
			delegationABI,
			wallet || provider
		),
		// eslint-disable-next-line camelcase
		contract: ReclaimServiceManager__factory.connect(
			contractAddress,
			wallet || provider
		),
		registryContract: new ethers.Contract(
			stakeRegistryAddress,
			registryABI,
			wallet || provider
		),
		avsDirectory: new ethers.Contract(
			avsDirectoryAddress,
			avsDirectoryABI,
			wallet || provider
		),
	}
}