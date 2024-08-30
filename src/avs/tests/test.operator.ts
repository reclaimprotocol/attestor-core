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

import { Wallet } from 'ethers'
import { arrayify } from 'ethers/lib/utils'
import assert from 'node:assert'
import type { createClaimOnWitness } from '../../create-claim'
import { ClaimInfo } from '../../types'
import { canonicalStringify, createSignDataForClaim, getIdentifierFromClaimInfo } from '../../utils'
import { CHAIN_CONFIG } from '../config'
import { ReclaimServiceManager__factory } from '../contracts'
import { NewTaskCreatedEventObject, TaskCompletedEventObject } from '../contracts/ReclaimServiceManager'
import { createClaimOnAvs } from '../create-claim-on-avs'
import { getContracts } from '../utils/contracts'
import { registerOperator } from '../utils/register'
import { runFreshChain, sendGasToAddress } from './utils'

const contracts = getContracts()

jest.setTimeout(60_000)

describe('Operators', () => {

	let shutdownChain: () => void
	let operators: {
		wallet: Wallet
		url: string
	}[] = []
	const createClaimFn = jest.fn<
		ReturnType<typeof createClaimOnWitness>,
		Parameters<typeof createClaimOnWitness>
	>(() => {
		throw new Error('Not implemented')
	})

	let registeredFirstOperator = false
	let registeredSecondOperator = false

	beforeAll(async() => {
		shutdownChain = await runFreshChain()
		operators = [{ wallet: contracts.wallet, url: 'ws://example.com' }]

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

			const data = createSignDataForClaim({
				provider: name,
				parameters: canonicalStringify(params),
				context: context
					? canonicalStringify(context)
					: '',
				timestampS: timestampS!,
				owner: userWallet.address,
				epoch: 1
			})

			const signData = await op.wallet.signMessage(data)
			const signArray = arrayify(signData)

			return {
				signatures: { claimSignature: signArray }
			} as any
		})
	})

	afterAll(async() => {
		await shutdownChain?.()
	})

	it('should register the operator on chain', async() => {
		await registerFirstOperator()
	})

	it('should not throw an error on repeated registration', async() => {
		await registerFirstOperator()
		await registerOperator()
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

		it('should create a task', async() => {
			arg = await createNewTask(userWallet)
		})

		it('should mark a task as completed', async() => {
			if(!arg) {
				arg = await createNewTask(userWallet)
			}

			await markTaskAsCompleted(userWallet, arg)
		})

		it(
			'should create claim via createClaimOnChain',
			createClaimViaFn
		)
	})

	async function registerFirstOperator() {
		if(registeredFirstOperator) {
			return
		}

		// fetch address from the env variable, PRIVATE_KEY
		const operatorAddress = await contracts.wallet.address
		await sendGasToAddress(operatorAddress)
		await registerOperator({
			wallet: operators[0].wallet,
			reclaimRpcUrl: operators[0].url
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
		const url = 'ws://abcd.com/ws'
		await sendGasToAddress(wallet2.address)
		await registerOperator({
			wallet: wallet2,
			reclaimRpcUrl: url
		})

		const newAddr = await wallet2.address

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

	async function createNewTask(userWallet: Wallet) {
		// eslint-disable-next-line camelcase
		const contract = ReclaimServiceManager__factory.connect(
			await CHAIN_CONFIG.contractAddress,
			userWallet
		)

		const params = makeNewCreateClaimParams()
		const task = await contract.createNewTask({
			provider: params.provider,
			claimUserId: new Uint8Array(32),
			claimHash: getIdentifierFromClaimInfo(params),
			owner: await userWallet.address,
		})
		const rslt = await task.wait()
		const events = rslt.events
		assert.equal(events?.length, 1)
		// check task created event was emitted
		const ev = events?.[0]
		const arg = ev?.args as unknown as NewTaskCreatedEventObject

		assert.equal(ev?.event, 'NewTaskCreated')
		assert.equal(arg?.task?.request?.provider, params.provider)

		return arg
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
			owner: await userWallet.address,
			epoch: 1
		})
		const signatures: string[] = []
		for(const { wallet: operator } of operators) {
			const opAddr = await operator.address
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
		const arg = events?.[0]?.args as unknown as TaskCompletedEventObject
		assert.strictEqual(events?.length, 1)

		assert.ok(arg.task)
	}

	async function createClaimViaFn() {
		const tx = await contracts.contract.setMinSignaturesPerTask(2)
		await tx.wait()
		console.log('min sigs set to 2')

		const userWallet = randomWallet()
		await sendGasToAddress(userWallet.address)

		const rslt = await createClaimOnAvs({
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
			createClaimOnWitness: createClaimFn
		})

		// ensure two operators were selected
		assert.equal(rslt.task.task.operators.length, 2)
		assert.equal(rslt.task.signatures.length, 2)
	}
})

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