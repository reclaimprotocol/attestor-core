import { ethers } from 'ethers'
import { CHAIN_CONFIGS, PRIVATE_KEY, SELECTED_CHAIN_ID } from 'src/avs/config'
import { AVSDirectory__factory, DelegationManager__factory, ECDSAStakeRegistry__factory, ReclaimServiceManager__factory } from 'src/avs/contracts'
import { ChainConfig } from 'src/avs/types'

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
		// eslint-disable-next-line camelcase
		delegationManager: DelegationManager__factory.connect(
			delegationManagerAddress,
			wallet || provider
		),
		// eslint-disable-next-line camelcase
		contract: ReclaimServiceManager__factory.connect(
			contractAddress,
			wallet || provider
		),
		// eslint-disable-next-line camelcase
		registryContract: ECDSAStakeRegistry__factory.connect(
			stakeRegistryAddress,
			wallet || provider
		),
		// eslint-disable-next-line camelcase
		avsDirectory: AVSDirectory__factory.connect(
			avsDirectoryAddress,
			wallet || provider
		),
	}
}