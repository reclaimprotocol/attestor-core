
import type { createClaimOnWitness } from '../../create-claim'
import type { ClaimTunnelResponse } from '../../proto/api'
import type { CreateClaimOnWitnessOpts, ProofGenerationStep, ProviderName } from '../../types'
import type { NewTaskCreatedEventObject } from '../contracts/ReclaimServiceManager'

export type ChainConfig = {
	rpcUrl: string
	/**
	 * Reclaim AVS contract address
	 */
	contractAddress: string
	delegationManagerAddress: string
	stakeRegistryAddress: string
	avsDirectoryAddress: string
}

export type CreateClaimOnAvsStep = {
	type: 'taskCreated'
	data: NewTaskCreatedEventObject
} | {
	type: 'witnessStep'
	data: {
		operatorAddress: string
		step: ProofGenerationStep
	}
} | {
	type: 'witnessDone'
	data: {
		task: NewTaskCreatedEventObject
		/**
		 * Index of the operator in the task
		 * that has finished the proof generation
		 */
		responsesDone: ClaimTunnelResponse[]
	}
}

export type CreateClaimOnAvsOpts<N extends ProviderName> = (
	Omit<CreateClaimOnWitnessOpts<N>, 'onStep' | 'client'>
) & {
	/**
	 * Chain ID to use for the claim
	 * @default -- env variable CHAIN_ID
	 */
	chainId?: string
	onStep?(step: CreateClaimOnAvsStep): void
	/**
	 * Override the default createClaimOnWitness function
	 */
	createClaimOnWitness?: typeof createClaimOnWitness
}