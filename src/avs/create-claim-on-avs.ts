import { createClaimOnWitness as _createClaimOnWitness } from '../create-claim'
import { ClaimTunnelResponse } from '../proto/api'
import { ProviderName } from '../types'
import { canonicalStringify, getIdentifierFromClaimInfo } from '../utils'
import { logger as LOGGER } from '../utils/logger'
import { NewTaskCreatedEventObject, TaskCompletedEventObject } from './contracts/ReclaimServiceManager'
import { initialiseContracts } from './utils/contracts'
import { CHAIN_CONFIGS, SELECTED_CHAIN_ID } from './config'
import { CreateClaimOnAvsOpts } from './types'

const EMPTY_CLAIM_USER_ID = new Uint8Array(32)
/**
 * Creates a Reclaim claim on the AVS chain.
 */
export async function createClaimOnAvs<N extends ProviderName>({
	onStep,
	createClaimOnWitness = _createClaimOnWitness,
	chainId = SELECTED_CHAIN_ID,
	...opts
}: CreateClaimOnAvsOpts<N>) {
	const {
		logger = LOGGER,
		ownerPrivateKey,
		name,
		params,
		context,
	} = opts
	const { contract, wallet } = initialiseContracts(
		CHAIN_CONFIGS[chainId!],
		ownerPrivateKey
	)

	logger.info(
		{ owner: wallet.address, contract: contract.address },
		'creating claim'
	)

	const task = await contract.createNewTask({
		provider: name,
		// blank for now -- till we figure out the right
		// algorithm for this
		claimUserId: EMPTY_CLAIM_USER_ID,
		claimHash: getIdentifierFromClaimInfo({
			provider: name,
			parameters: canonicalStringify(params),
			context: context
				? canonicalStringify(context)
				: '',
		}),
		owner: wallet.address,
	})

	const tx = await task.wait()
	// check task created event was emitted
	const ev = tx.events?.[0]
	const arg = ev?.args as unknown as NewTaskCreatedEventObject
	if(!arg) {
		throw new Error('INTERNAL: Task creation failed, no event emitted')
	}

	logger.info(
		{
			index: arg.taskIndex,
			operators: arg.task.operators.length,
		},
		'task created, collecting claim signatures...'
	)

	onStep?.({ type: 'taskCreated', data: arg })

	const responses: ClaimTunnelResponse[] = []
	const timestampS = +arg.task.createdAt.toString()
	for(const op of arg.task.operators) {
		const res = await createClaimOnWitness({
			...opts,
			client: { url: op.url },
			timestampS,
			onStep: (step) => (
				onStep?.({
					type: 'witnessStep',
					data: {
						operatorAddress: op.addr,
						step,
					},
				})
			),
			logger: logger.child({ operator: op.addr }),
		})
		const signature = res.signatures?.claimSignature
		if(!signature) {
			throw new Error('INTERNAL: Claim signature not generated')
		}

		responses.push(res)

		logger.info(
			{ operator: op.addr },
			'witness signature generated'
		)

		onStep?.({
			type: 'witnessDone',
			data: {
				task: arg,
				responsesDone: responses,
			},
		})
	}

	const taskComplete = await contract.taskCompleted(
		{
			task: arg.task,
			signatures: responses
				.map(res => res.signatures?.claimSignature!),
		},
		arg.taskIndex
	)
	const tx2 = await taskComplete.wait()
	// check task created event was emitted
	const ev2 = tx2.events?.[0]
	const completedData = ev2?.args as unknown as TaskCompletedEventObject

	logger.info(
		{
			tx: tx2.transactionHash,
			task: arg.taskIndex,
		},
		'claim submitted & validated'
	)

	return completedData
}