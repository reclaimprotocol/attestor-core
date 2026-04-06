import { EventLog, hexlify, Wallet } from 'ethers'

import { CHAIN_CONFIGS, SELECTED_CHAIN_ID } from '#src/avs/config.ts'
import type { IReclaimServiceManager, NewTaskCreatedEvent, TaskCompletedEvent } from '#src/avs/contracts/ReclaimServiceManager.ts'
import type { CreateClaimOnAvsOpts } from '#src/avs/types/index.ts'
import { initialiseContracts } from '#src/avs/utils/contracts.ts'
import { createNewClaimRequestOnChain, signClaimRequest } from '#src/avs/utils/tasks.ts'
import { createClaimOnAttestor as _createClaimOnAttestor, getAttestorClientFromPool } from '#src/client/index.ts'
import type { ClaimRequestData, ClaimTunnelResponse, ProviderClaimData } from '#src/proto/api.ts'
import type { ProviderName } from '#src/types/index.ts'
import { AttestorError, canonicalStringify, getIdentifierFromClaimInfo, logger as LOGGER, unixTimestampSeconds } from '#src/utils/index.ts'

const EMPTY_CLAIM_USER_ID = hexlify(new Uint8Array(32))

/**
 * Creates a Reclaim claim on the AVS chain.
 */
export async function createClaimOnAvs<N extends ProviderName>({
	onStep,
	createClaimOnAttestor = _createClaimOnAttestor,
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
	const { contract, wallet, provider } = initialiseContracts(
		CHAIN_CONFIGS[chainId!],
		ownerPrivateKey
	)

	logger.info(
		{ owner: wallet!.address, contract: await contract.getAddress() },
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
		const res = await createClaimOnAttestor({
			...opts,
			client: { url: op.url },
			timestampS,
			onStep: (step) => (
				onStep?.({
					type: 'attestorStep',
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
			throw new AttestorError(
				'ERROR_INVALID_CLAIM',
				`Claim request does not match the claim res data: ${diff}`,
				{
					diff,
					request: res.request?.data?.[diff],
					claim: res.claim?.[diff]
				}
			)
		}

		responses.push(res)

		logger.info({ operator: op.addr }, 'signature generated')

		onStep?.({
			type: 'attestorDone',
			data: {
				task: arg,
				responsesDone: responses,
			},
		})
	}

	const rslt = await completeTask()

	logger.info(
		{ tx: rslt.txHash, task: arg.taskIndex },
		'claim submitted & validated'
	)

	return { ...rslt, claimData: responses[0].claim! }

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
			const payerWallet = new Wallet(ownerPrivateKey, provider)
			const { task } = await createNewClaimRequestOnChain({
				request,
				payer: payerWallet,
				owner: payerWallet,
				chainId
			})
			return task
		}

		const requestSignature = await signClaimRequest(
			request,
			wallet!,
			chainId
		)
		const client = getAttestorClientFromPool(payer.attestor)
		await client.waitForInit()
		const rslt = await client.rpc('createClaimOnChain', {
			chainId: +chainId!,
			jsonCreateClaimRequest: JSON.stringify(request),
			requestSignature
		})

		return JSON.parse(rslt.jsonTask) as NewTaskCreatedEvent.OutputObject
	}

	async function completeTask() {
		const data: IReclaimServiceManager.CompletedTaskStruct = {
			task: arg.task,
			signatures: responses
				.map(res => (
					hexlify(res.signatures?.claimSignature!)
				)),
		}

		if(!payer) {
			const tx = await contract.taskCompleted(data, arg.taskIndex)
			const rslt = await tx.wait()
			// check task created event was emitted
			const logs = rslt?.logs ?? []
			const eventLogs = logs.filter((log): log is EventLog => log instanceof EventLog)
			const ev = eventLogs[0]
			return {
				object: ev?.args as unknown as TaskCompletedEvent.OutputObject,
				txHash: rslt!.hash
			}
		}

		const client = getAttestorClientFromPool(payer.attestor)
		await client.waitForInit()
		const rslt = await client.rpc('completeClaimOnChain', {
			chainId: +chainId!,
			taskIndex: Number(arg.taskIndex),
			completedTaskJson: JSON.stringify(data)
		})
		const object = JSON.parse(rslt.taskCompletedObjectJson) as TaskCompletedEvent.OutputObject
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