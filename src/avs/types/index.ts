
import type { NewTaskCreatedEventObject } from 'src/avs/contracts/ReclaimServiceManager'
import type { createClaimOnAttestor } from 'src/client'
import type { ClaimTunnelResponse } from 'src/proto/api'
import type { CreateClaimOnAttestorOpts, ProofGenerationStep, ProviderName } from 'src/types'

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
	type: 'attestorStep'
	data: {
		operatorAddress: string
		step: ProofGenerationStep
	}
} | {
	type: 'attestorDone'
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
	Omit<CreateClaimOnAttestorOpts<N>, 'onStep' | 'client'>
) & {
	/**
	 * Chain ID to use for the claim
	 * @default -- env variable CHAIN_ID
	 */
	chainId?: string
	/**
	 * Who will pay for the claim creation, including gas
	 * costs. Note: the attestor can choose to reject the
	 * claim if 'attestor' is chosen.
	 * @default undefined (owner of the claim)
	 */
	payer?: { attestor: string }

	onStep?(step: CreateClaimOnAvsStep): void
	/**
	 * Override the default createClaimOnAttestor function
	 */
	createClaimOnAttestor?: typeof createClaimOnAttestor
}