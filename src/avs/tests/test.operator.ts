/**
 * This file tests the operator registration and task creation.
 * The tests were initially written using Node's own testing framework, but
 * later switched to Jest. Thus, the tests were initially written in a nested
 * format, but were later refactored to use Jest's `describe` and `it` functions.
 * Apologies for the hence resulting inconsistency in the code style.
 *
 * The nesting of tests is helpful as the tests logically depend on each other,
 * and the nesting helps save time by not repeating the same setup code.
 */

// eslint-disable-next-line simple-import-sort/imports
import 'src/server/utils/config-env'

import { Wallet } from 'ethers'
import { arrayify } from 'ethers/lib/utils'
import assert from 'node:assert'
import { createClaimOnAvs } from 'src/avs/client/create-claim-on-avs'
import { NewTaskCreatedEventObject, TaskCompletedEventObject } from 'src/avs/contracts/ReclaimTaskManager'
import { runFreshChain, sendGasToAddress, submitPaymentRoot } from 'src/avs/tests/utils'
import { getContracts } from 'src/avs/utils/contracts'
import { registerOperator } from 'src/avs/utils/register'
import { createNewClaimRequestOnChain } from 'src/avs/utils/tasks'
import type { createClaimOnAttestor } from 'src/client'
import { describeWithServer } from 'src/tests/describe-with-server'
import { ClaimInfo, CompleteClaimData } from 'src/types'
import { canonicalStringify, createSignDataForClaim, getIdentifierFromClaimInfo, logger, unixTimestampSeconds } from 'src/utils'

const contracts = getContracts()

const defaultFee = 0x1000

jest.setTimeout(60_000)

describe('Operators', () => {

	let shutdownChain: () => void
	let operators: {
		wallet: Wallet
		url: string
	}[] = []
	const createClaimFn = jest.fn<
		ReturnType<typeof createClaimOnAttestor>,
		Parameters<typeof createClaimOnAttestor>
	>(() => {
		throw new Error('Not implemented')
	})

	let registeredFirstOperator = false
	let registeredSecondOperator = false

	beforeAll(async() => {
		shutdownChain = await runFreshChain()
		operators = [{ wallet: contracts.wallet!, url: 'ws://example.com' }]

		createClaimFn.mockImplementation(async({
			ownerPrivateKey, name, params, context, client, timestampS
		}) => {
			if(!('url' in client)) {
				throw new Error('Invalid client')
			}

			const op = operators
				.find(op => op.url === client.url.toString())
			if(!op) {
				throw new Error('Operator not found: ' + client.url)
			}

			const userWallet = new Wallet(ownerPrivateKey, contracts.provider)
			const data: CompleteClaimData = {
				provider: name,
				parameters: canonicalStringify(params),
				context: context
					? canonicalStringify(context)
					: '',
				timestampS: timestampS!,
				owner: userWallet.address,
				epoch: 1
			}
			const signStr = createSignDataForClaim(data)

			const signData = await op.wallet.signMessage(signStr)
			const signArray = arrayify(signData)

			return {
				claim: data,
				request: { data },
				signatures: { claimSignature: signArray }
			} as any
		})
	})

	afterAll(async() => {
		await shutdownChain?.()
	})

	it('should prevent registration of non-whitelisted operator', async() => {
		const op = randomWallet()
		const url = 'ws://abcd.com/ws'
		await sendGasToAddress(op.address)

		// using try-catch since jest.rejects.toMatchObject wasn't
		// working as expected
		try {
			await registerOperator({
				wallet: op,
				reclaimRpcUrl: url
			})
			throw new Error('Should have thrown an error')
		} catch(err) {
			expect(err.message).toMatch(/Operator not whitelisted/)
		}
	})

	it('should prevent non-admins from modifying internal settings', async() => {
		const nonAdmin = randomWallet()
		await sendGasToAddress(nonAdmin.address)

		const contract = contracts.contract.connect(nonAdmin)

		const OPS = [
			() => (
				contract.whitelistAddressAsOperator(
					nonAdmin.address,
					true
				)
			),
			() => (
				contract.updateTaskCreationMetadata({
					minSignaturesPerTask: 2,
					maxTaskLifetimeS: 10,
					maxTaskCreationDelayS: 0,
					minFee: defaultFee,
				})
			)
		]

		for(const op of OPS) {
			try {
				await op()
				throw new Error('Should have thrown an error')
			} catch(err) {
				expect(err.message).toMatch(/caller is not the owner/)
			}
		}
	})

	it('should register the operator on chain', async() => {
		await registerFirstOperator()
	})

	it('should not throw an error on repeated registration', async() => {
		await registerFirstOperator()
		await registerOperator({
			wallet: operators[0].wallet,
			reclaimRpcUrl: operators[0].url,
		})
	})

	it('should register multiple operators', async() => {
		await registerFirstOperator()
		await registerSecondOperator()
	})

	describe('With Task', () => {

		let userWallet: Wallet
		let arg: NewTaskCreatedEventObject

		beforeAll(async() => {
			await registerFirstOperator()
			await registerSecondOperator()

			userWallet = randomWallet()
			await sendGasToAddress(userWallet.address)
		})

		it('should fail to create a task w insufficient balance', async() => {
			await expect(
				createNewTask(userWallet)
			).rejects.toMatchObject({
				message: /transfer amount exceeds balance/
			})
		})

		it('should create a task', async() => {
			// add fees for wallet to create a task
			await addTokensToAddress(userWallet.address)
			arg = await createNewTask(userWallet)
		})

		it('should mark a task as completed', async() => {
			if(!arg) {
				await addTokensToAddress(userWallet.address)
				arg = await createNewTask(userWallet)
			}

			const {
				taskCompletedEvent: { task }, events
			} = await markTaskAsCompleted(userWallet, arg)

			const rewardsCoordEvents = events
				?.filter(ev => (
					ev.address.toLowerCase()
						=== contracts.rewardsCoordinator.address.toLowerCase()
				))
				?.map(ev => (
					contracts.rewardsCoordinator.interface.parseLog(ev)
				))
			expect(rewardsCoordEvents).toHaveLength(1)

			const evArgs = rewardsCoordEvents![0].args
			// hardcode the index of the endTimestamp -- as the logs
			// don't have the keys of the event args
			const endTimestamp = evArgs[4][3]

			await submitPaymentRoot(
				task.task.operators[0].addr,
				endTimestamp,
				task.task.feePaid.toNumber()
			)

			const nonce = await contracts.rewardsCoordinator
				.getDistributionRootsLength()
			expect(nonce.toNumber()).toBeGreaterThan(0)
		})

		it('should allow another wallet to create a task', async() => {
			const ownerWallet = randomWallet()
			await addTokensToAddress(userWallet.address)
			const rslt = await createNewTask(userWallet, ownerWallet)
			assert.strictEqual(rslt.task.request.owner, ownerWallet.address)
		})
	})

	describeWithServer('With Task & Attestor Server', opts => {
		beforeAll(async() => {
			await registerFirstOperator()
			await registerSecondOperator()
		})

		it(
			'should create claim via createClaimOnChain',
			createClaimViaFn
		)

		it('should make attestor pay for claim', async() => {
			const userWallet = randomWallet()

			// default address is the attestor's address
			await addTokensToAddress(contracts.wallet!.address)

			const { object: rslt } = await createClaimOnAvs({
				ownerPrivateKey: userWallet.privateKey,
				name: 'http',
				params: {
					url: 'https://example.com',
					method: 'GET',
					responseRedactions: [],
					responseMatches: [
						{
							type: 'contains',
							value: 'test'
						}
					]
				},
				secretParams: {},
				payer: { attestor: opts.serverUrl },
				createClaimOnAttestor: createClaimFn
			})

			assert.strictEqual(rslt.task.task.request.owner, userWallet.address)
		})
	})

	async function registerFirstOperator() {
		if(registeredFirstOperator) {
			return
		}

		// fetch address from the env variable, PRIVATE_KEY
		const operatorAddress = await contracts.wallet!.address
		await sendGasToAddress(operatorAddress)

		console.log('owner ', await contracts.contract.owner())

		await contracts.contract.whitelistAddressAsOperator(
			operatorAddress,
			true
		)

		await registerOperator({
			wallet: operators[0].wallet,
			reclaimRpcUrl: operators[0].url,
			logger: logger.child({ op: operatorAddress })
		})

		assert.strictEqual(
			await contracts.registryContract
				.operatorRegistered(operatorAddress),
			true
		)

		const op = await contracts.contract.registeredOperators(0)
		assert.strictEqual(op.addr, operatorAddress)

		registeredFirstOperator = true
	}

	async function registerSecondOperator() {
		if(registeredSecondOperator) {
			return
		}

		const wallet2 = randomWallet()
		const newAddr = wallet2.address
		const url = 'ws://abcd.com/ws'
		await sendGasToAddress(newAddr)

		await contracts.contract
			.whitelistAddressAsOperator(newAddr, true)
		await registerOperator({
			wallet: wallet2,
			reclaimRpcUrl: url,
			logger: logger.child({ op: newAddr })
		})

		assert.strictEqual(
			await contracts.registryContract.operatorRegistered(newAddr),
			true
		)

		const meta = await contracts.contract
			.getMetadataForOperator(newAddr)
		assert.strictEqual(meta.url, url)
		assert.strictEqual(meta.addr, newAddr)

		operators.push({ wallet: wallet2, url })

		registeredSecondOperator = true
	}

	async function createNewTask(
		userWallet: Wallet,
		claimOwner = userWallet
	) {
		const params = makeNewCreateClaimParams()

		const { task } = await createNewClaimRequestOnChain({
			request: {
				provider: params.provider,
				claimUserId: new Uint8Array(32),
				claimHash: getIdentifierFromClaimInfo(params),
				requestedAt: unixTimestampSeconds(),
				fee: defaultFee
			},
			payer: userWallet,
			owner: claimOwner
		})
		assert.strictEqual(!!task, true)
		assert.equal(task?.task?.request?.provider, params.provider)

		return task
	}

	async function markTaskAsCompleted(
		userWallet: Wallet,
		{ task, taskIndex }: NewTaskCreatedEventObject
	) {
		assert.ok(
			task.operators.length > 0,
			'No operators selected for the task'
		)

		const req = task.request
		const signData = createSignDataForClaim({
			identifier: req.claimHash,
			timestampS: +task.createdAt.toString(),
			owner: userWallet.address,
			epoch: 1
		})
		const signatures: string[] = []
		for(const { wallet: operator } of operators) {
			const opAddr = operator.address
			const selectedOp = task.operators
				.some(op => op.addr === opAddr)
			if(!selectedOp) {
				continue
			}

			const signature = await operator
				.signMessage(signData)
			signatures.push(signature)
		}

		assert.strictEqual(signatures.length, task.operators.length)
		const tx = await contracts.contract
			.connect(userWallet)
			.taskCompleted(
				{ task, signatures },
				taskIndex
			)
		const rslt = await tx.wait()
		const events = rslt.events
		const taskCompletedEvent = events
			?.find(ev => (ev.event === 'TaskCompleted'))
			?.args as unknown as TaskCompletedEventObject
		assert.ok(taskCompletedEvent.task)

		return { taskCompletedEvent, events }
	}

	async function createClaimViaFn() {
		const tx = await contracts.contract.updateTaskCreationMetadata({
			minSignaturesPerTask: 2,
			maxTaskLifetimeS: 0,
			maxTaskCreationDelayS: 0,
			minFee: defaultFee
		})
		await tx.wait()
		console.log('min sigs set to 2')

		const userWallet = randomWallet()
		await sendGasToAddress(userWallet.address)
		await addTokensToAddress(userWallet.address)

		const { object: rslt } = await createClaimOnAvs({
			ownerPrivateKey: userWallet.privateKey,
			name: 'http',
			params: {
				url: 'https://example.com',
				method: 'GET',
				responseRedactions: [],
				responseMatches: [
					{
						type: 'contains',
						value: 'test'
					}
				]
			},
			secretParams: {},
			createClaimOnAttestor: createClaimFn
		})

		// ensure two operators were selected
		assert.equal(rslt.task.task.operators.length, 2)
		assert.equal(rslt.task.signatures.length, 2)
	}
})

async function addTokensToAddress(address: string) {
	const mocktoken = await contracts.tokens.getDefault()
	const tx = await mocktoken
		.mint(address, defaultFee)
	await tx.wait()
}

function randomWallet() {
	return Wallet.createRandom()
		.connect(contracts.provider)
}

function makeNewCreateClaimParams(): ClaimInfo {
	return {
		provider: 'http',
		parameters: canonicalStringify({
			url: 'https://example.com',
			method: 'GET',
			responseRedactions: [],
			responseMatches: [
				{
					type: 'contains',
					value: 'test'
				}
			]
		}),
		context: ''
	}
}