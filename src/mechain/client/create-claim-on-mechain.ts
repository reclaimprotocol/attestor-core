
import { Contract, providers, utils, Wallet } from 'ethers'
import { createClaimOnAttestor as _createClaimOnAttestor } from 'src/client'
import { AttestorClient } from 'src/client'
import { governanceABI } from 'src/mechain/abis/governanceABI'
import { taskABI } from 'src/mechain/abis/taskABI'
import { GOVERNANCE_CONTRACT_ADDRESS, RPC_URL, TASK_CONTRACT_ADDRESS } from 'src/mechain/constants'
import { CreateClaimOnMechainOpts } from 'src/mechain/types'
import { ProviderName } from 'src/types'
import { CreateClaimResponse } from 'src/window-rpc'
import { mapToCreateClaimResponse } from 'src/window-rpc/utils'

/**
 * Creates a Reclaim claim on the AVS chain.
 */
export async function createClaimOnMechain<N extends ProviderName>({
	createClaimOnAttestor = _createClaimOnAttestor,
	onStep,
	...opts
}: CreateClaimOnMechainOpts<N>) {


	const { taskContract } = await getContracts()

	// Construct parameters for the createNewTaskRequest function
	const seed = utils.randomBytes(32)
	const timestamp = Math.floor(Date.now() / 1000)

	// Perform a static call to fetch taskId and attestors for the next task
	const result = await taskContract.callStatic.createNewTaskRequest(
		seed,
		timestamp
	)
	const taskId = result[0] as number

	// fetch requiredAttestors to determine how many proofs to request
	const requiredAttestors = await taskContract.requiredAttestors()
	onStep?.({ type: 'requiredAttestorsFetched', data: requiredAttestors })

	const responses: CreateClaimResponse [] = []

	for(let i = 0; i < requiredAttestors; i++) {
		// Fetched attestors's WebSocket URI, e.g. wss://attestor.reclaimprotocol.org/ws
		const host = result[1][i].host

		onStep?.({ type: 'attestorFetched', data: host })

		const client = new AttestorClient({
			url: host
		})

		const claimTunnelRes = await createClaimOnAttestor ({
			...opts,
			client
		})

		const response = mapToCreateClaimResponse(
			claimTunnelRes
		)
		responses.push(response)
	}

	// Perform the call that was statically-called previously
	const tx = await taskContract.createNewTaskRequest(seed, timestamp)
	await tx.wait()

	onStep?.({ type: 'taskCreated', data: taskId })

	return { taskId, responses }

}

async function getContracts() {
	const privateKey = process.env.MECHAIN_PRIVATE_KEY!
	if(!privateKey) {
		throw new Error('PRIVATE_KEY environment variable is not set')
	}

	try {
		const provider = new providers.JsonRpcProvider(RPC_URL)
		// Validate connection to provider
		await provider.getNetwork()

		const signer = new Wallet(privateKey, provider)

		const taskContract = new Contract(
			TASK_CONTRACT_ADDRESS,
			taskABI,
			signer
		)

		const governanceContract = new Contract(
			GOVERNANCE_CONTRACT_ADDRESS,
			governanceABI,
			signer
		)

		return { taskContract, governanceContract }
	} catch(error) {
		throw new Error(`Failed to initialize contracts: ${error.message || error}`)
	}

}

