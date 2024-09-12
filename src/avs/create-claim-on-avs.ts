import { ethers, Wallet } from 'ethers'
import { createClaimOnWitness as _createClaimOnWitness, getWitnessClientFromPool } from '../create-claim'
import { ClaimRequestData, ClaimTunnelResponse, ProviderClaimData } from '../proto/api'
import { ProviderName } from '../types'
import { canonicalStringify, getIdentifierFromClaimInfo, unixTimestampSeconds, WitnessError } from '../utils'
import { logger as LOGGER } from '../utils/logger'
import { IReclaimServiceManager, NewTaskCreatedEventObject, TaskCompletedEventObject } from './contracts/ReclaimServiceManager'
import { initialiseContracts } from './utils/contracts'
import { createNewClaimRequestOnChain, signClaimRequest } from './utils/tasks'
import { CHAIN_CONFIGS, SELECTED_CHAIN_ID } from './config'
import { CreateClaimOnAvsOpts } from './types'

const EMPTY_CLAIM_USER_ID = ethers.utils.hexlify(new Uint8Array(32))

/**
 * Creates a Reclaim claim on the AVS chain.
 */
export async function createClaimOnAvs<N extends ProviderName>({
	onStep,
	createClaimOnWitness = _createClaimOnWitness,
	chainId = SELECTED_CHAIN_ID,
	payer,
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
		{ owner: wallet!.address, contract: contract.address },
		'creating claim'
	)

	const arg = await requestClaimCreation()

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

		const diff = getClaimRequestDifference(res.request?.data!, res.claim!)
		if(diff) {
			throw new WitnessError(
				'WITNESS_ERROR_INVALID_CLAIM',
				`Claim request does not match the claim res data: ${diff}`,
				{
					diff,
					request: res.request?.data?.[diff],
					claim: res.claim?.[diff]
				}
			)
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

	const {
		object: completedData,
		txHash
	} = await completeTask()

	logger.info(
		{ tx: txHash, task: arg.taskIndex },
		'claim submitted & validated'
	)

	return completedData

	async function requestClaimCreation() {
		const request: IReclaimServiceManager.ClaimRequestStruct = {
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
			owner: wallet!.address,
			requestedAt: unixTimestampSeconds()
		}

		if(!payer) {
			const wallet = new Wallet(ownerPrivateKey, contract.provider)
			const { task } = await createNewClaimRequestOnChain({
				request,
				payer: wallet,
				owner: wallet,
				chainId
			})
			return task
		}

		const requestSignature = await signClaimRequest(
			request,
			wallet!,
			chainId
		)
		const client = getWitnessClientFromPool(payer.witness)
		await client.waitForInit()
		const rslt = await client.rpc('createClaimOnChain', {
			chainId: +chainId!,
			jsonCreateClaimRequest: JSON.stringify(request),
			requestSignature
		})

		return JSON.parse(rslt.jsonTask) as NewTaskCreatedEventObject
	}

	async function completeTask() {
		const data: IReclaimServiceManager.CompletedTaskStruct = {
			task: arg.task,
			signatures: responses
				.map(res => (
					ethers.utils.hexlify(res.signatures?.claimSignature!)
				)),
		}

		if(!payer) {
			const tx = await contract.taskCompleted(data, arg.taskIndex)
			const rslt = await tx.wait()
			// check task created event was emitted
			const ev = rslt.events?.[0]
			return {
				object: ev?.args as unknown as TaskCompletedEventObject,
				txHash: rslt.transactionHash
			}
		}

		const client = getWitnessClientFromPool(payer.witness)
		await client.waitForInit()
		const rslt = await client.rpc('completeClaimOnChain', {
			chainId: +chainId!,
			taskIndex: arg.taskIndex,
			completedTaskJson: JSON.stringify(data)
		})
		const object = JSON.parse(rslt.taskCompletedObjectJson) as TaskCompletedEventObject
		return { object, txHash: rslt.txHash }
	}
}

type Req = ProviderClaimData | ClaimRequestData

function getClaimRequestDifference(a: Req, b: Req): (keyof Req) | undefined {
	if(a.provider !== b.provider) {
		return 'provider'
	}

	if(a.context !== b.context) {
		return 'context'
	}

	if(a.parameters !== b.parameters) {
		return 'parameters'
	}

	if(a.timestampS !== b.timestampS) {
		return 'timestampS'
	}
}