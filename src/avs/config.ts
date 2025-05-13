import type { ChainConfig } from 'src/avs/types'
import { getEnvVariable } from 'src/utils/env'

export const CHAIN_CONFIGS: { [key: string]: ChainConfig } = {
	'31337': {
		rpcUrl: 'http://localhost:8545',
		contractAddress: '0x1291be112d480055dafd8a610b7d1e203891c274',
		delegationManagerAddress: '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
		stakeRegistryAddress: '0x4826533b4897376654bb4d4ad88b7fafd0c98528',
		avsDirectoryAddress: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
		rewardsCoordinatorAddress: '0x610178da211fef7d417bc0e6fed39f05609ad788',
		slashingCoordinatorAddress: '0x7969c5ed335650692bc04293b07f5bf2e7a673c0'
	},
	'17000': {
		rpcUrl: getEnvVariable('RPC_URL') || 'https://rpc.holesky.ethpandaops.io',
		contractAddress: '0x0861afc305999bfD3028dB66145395BdD7299366',
		delegationManagerAddress: '0xA44151489861Fe9e3055d95adC98FbD462B948e7',
		stakeRegistryAddress: '0xDa11C9Da04Ab02C4AF9374B27A5E727944D3E1dD',
		avsDirectoryAddress: '0x055733000064333CaDDbC92763c58BF0192fFeBf',
		rewardsCoordinatorAddress: '',
		slashingCoordinatorAddress: ''
	}
}

export const PRIVATE_KEY = getEnvVariable('PRIVATE_KEY')!

export const SELECTED_CHAIN_ID = getEnvVariable('CHAIN_ID')

export const RECLAIM_PUBLIC_URL = getEnvVariable('RECLAIM_PUBLIC_URL')!