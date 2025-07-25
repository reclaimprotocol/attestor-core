import { ethers } from 'ethers'
import { RECLAIM_PUBLIC_URL, SELECTED_CHAIN_ID } from 'src/avs/config'
import { AllocationManager__factory, SocketRegistry__factory } from 'src/avs/contracts'
import { getContracts } from 'src/avs/utils/contracts'
import { logger as LOGGER } from 'src/utils'

type RegisterOpts = {
	logger?: typeof LOGGER
	/**
	 * What chain to register the operator on
	 * @default -- env variable CHAIN_ID
	 */
	chainId?: string
	/**
	 * wallet of the operator.
	 * @default -- wallet specified in the contracts
	 *  fetched by the chainId
	 */
	wallet?: ethers.Wallet
	/**
	 * URL of the Reclaim RPC server.
	 * @default -- env variable RECLAIM_PUBLIC_URL
	 */
	reclaimRpcUrl?: string
}

const OP_SET_ID = 0

/**
 * Registers the operator on the chain, if required.
 * If already registered -- will just pass through
 */
export async function registerOperator({
	logger = LOGGER,
	chainId = SELECTED_CHAIN_ID,
	wallet = getContracts(chainId).wallet!,
	reclaimRpcUrl = RECLAIM_PUBLIC_URL
}: RegisterOpts = {}) {
	const contracts = getContracts(chainId)
	const delegationManager = contracts.delegationManager
		.connect(wallet)
	const avsDirectory = contracts.avsDirectory
		.connect(wallet)
	const contract = contracts.contract
		.connect(wallet)
	const registryContract = contracts.registryContract
		.connect(wallet)
	const slashingCoordinator = contracts.slashingCoordinator
		.connect(wallet)
	// eslint-disable-next-line camelcase
	const allocationManager = await AllocationManager__factory.connect(
		await slashingCoordinator.allocationManager(),
		wallet
	)

	const addr = await wallet.address

	try {
		const tx1 = await delegationManager.registerAsOperator(
			'0x0000000000000000000000000000000000000000',
			0,
			''
		)
		await tx1.wait()
		logger.info('operator registered on DM successfully')
	} catch(err) {
		if(
			!err.message.includes('operator has already registered')
			&& !err.message.includes('caller is already actively delegated')
		) {
			throw err
		}

		logger.info('Operator already registered on EL')
	}

	const tx = await allocationManager.registerForOperatorSets(addr, {
		operatorSetIds: [OP_SET_ID],
		avs: contract.address,
		data: new Uint8Array(0)
	})
	await tx.wait()

	logger.info('operator registered on AM successfully')

	// const salt = ethers.utils.hexlify(ethers.utils.randomBytes(32))
	// // Example expiry, 1 hour from now
	// const expiry = Math.floor(Date.now() / 1000) + 3600
	// // Define the output structure
	// const operatorSignature = { expiry, salt, signature: '' }
	// // Calculate the digest hash using the avsDirectory's method
	// const digestHash = await avsDirectory
	// 	.calculateOperatorAVSRegistrationDigestHash(
	// 		addr,
	// 		contract.address,
	// 		salt,
	// 		expiry
	// 	)

	// // Sign the digest hash with the operator's private key
	// const signingKey = new ethers.utils.SigningKey(
	// 	wallet.privateKey
	// )
	// const signature = signingKey.signDigest(digestHash)

	// // Encode the signature in the required format
	// operatorSignature.signature = ethers.utils.joinSignature(signature)

	// logger.info('operator signature generated successfully')

	// const isRegistered = await registryContract.operatorRegistered(addr)
	// if(!isRegistered) {
	// 	logger.info('registering operator on AVS...')
	// 	const tx2 = await registryContract
	// 		.registerOperatorWithSignature(operatorSignature, addr)
	// 	await tx2.wait()
	// 	logger.info('operator registered on AVS successfully')
	// } else {
	// 	logger.info('operator already registered on AVS')
	// }

	// eslint-disable-next-line camelcase
	const socketRegistry = SocketRegistry__factory.connect(
		await slashingCoordinator.socketRegistry(),
		wallet
	)
	const existingMetadata = await socketRegistry.getOperatorSocket(addr)
	const metadata = JSON.stringify({ url: reclaimRpcUrl })
	if(metadata === existingMetadata) {
		logger.info('operator metadata already up to date')
		return
	}

	await slashingCoordinator.updateSocket(metadata)

	logger.info({ metadata }, 'operator metadata updated successfully')
}