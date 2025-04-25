import { Contract, providers, utils, Wallet } from 'ethers'
import { governanceABI } from 'src/mechain/abis/governanceABI'
import { taskABI } from 'src/mechain/abis/taskABI'
import { GOVERNANCE_CONTRACT_ADDRESS, RPC_URL, TASK_CONTRACT_ADDRESS } from 'src/mechain/constants'
import { RPCHandler } from 'src/types'
import { getEnvVariable } from 'src/utils/env'


export const createTaskOnMechain: RPCHandler<'createTaskOnMechain'> = async({
	timestamp
}) => {

	const { taskContract } = await getContracts()

	const seed = utils.randomBytes(32)

	// Perform a static call to fetch taskId and attestors for the next task
	const result = await taskContract.callStatic.createNewTaskRequest(
		seed,
		timestamp
	)

	const taskId = result[0] as number

	// Fetch requiredAttestors to determine how many proofs to request
	const requiredAttestors = await taskContract.requiredAttestors()

	const hosts: string [] = []

	// Fetch attestors's WebSocket URI, e.g. wss://attestor.reclaimprotocol.org/ws
	for(let i = 0; i < requiredAttestors; i++) {
		hosts.push(result[1][i].host)
	}

	// Perform the call that was statically-called previously
	const tx = await taskContract.createNewTaskRequest(seed, timestamp)
	await tx.wait()

	return {
		taskId: taskId,
		requiredAttestors: requiredAttestors,
		hosts: hosts
	}
}

async function getContracts() {
	const privateKey = getEnvVariable('MECHAIN_PRIVATE_KEY')
	const taskContractAddress = getEnvVariable('TASK_CONTRACT_ADDRESS') || TASK_CONTRACT_ADDRESS
	const governanceContractAddress = getEnvVariable('GOVERNANCE_CONTRACT_ADDRESS') || GOVERNANCE_CONTRACT_ADDRESS

	if(!privateKey) {
		throw new Error('MECHAIN_PRIVATE_KEY environment variable is not set')
	}

	try {
		const provider = new providers.JsonRpcProvider(RPC_URL)
		// Validate connection to provider
		await provider.getNetwork()

		const signer = new Wallet(privateKey, provider)

		const taskContract = new Contract(
			taskContractAddress,
			taskABI,
			signer
		)

		const governanceContract = new Contract(
			governanceContractAddress,
			governanceABI,
			signer
		)

		return { taskContract, governanceContract }
	} catch(error) {
		throw new Error(`Failed to initialize contracts: ${error.message || error}`)
	}

}
