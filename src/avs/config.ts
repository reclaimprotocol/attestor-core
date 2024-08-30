import '../server/utils/config-env'
import type { ChainConfig } from './types'

export const CHAIN_CONFIGS: { [key: string]: ChainConfig } = {
	'31337': {
		rpcUrl: 'http://localhost:8545',
		contractAddress: '0x84eA74d481Ee0A5332c457a4d796187F6Ba67fEB',
		delegationManagerAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
		stakeRegistryAddress: '0x9E545E3C0baAB3E08CdfD552C960A1050f373042',
		avsDirectoryAddress: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707'
	}
}

export const PRIVATE_KEY = process.env.PRIVATE_KEY!

export const SELECTED_CHAIN_ID = process.env.CHAIN_ID

export const RECLAIM_PUBLIC_RPC_URL = process.env.RPC_URL!