import { ZKOperator } from '@reclaimprotocol/circom-chacha20'
import type { TLSConnectionOptions } from '@reclaimprotocol/tls'
import { ethers } from 'ethers'
import { Logger } from 'pino'
import { makeBeacon } from '../beacon'
import { InitialiseSessionRequest_BeaconBasedProviderClaimRequest as ProviderClaimRequest, ProviderClaimData } from '../proto/api'
import { ProviderName, ProviderParams, providers, ProviderSecretParams } from '../providers'
import { Beacon, CreateStep } from '../types'
import { createGrpcWebClient, unixTimestampSeconds } from '../utils'
import { fetchWitnessListForClaim, makeOwnerProof } from '../utils/beacon'
import { getIdentifierFromClaimInfo, stringifyClaimParameters } from '../utils/claims'
import LOGGER from '../utils/logger'
import { generateProviderReceipt } from './generate-provider-receipt'

export interface CreateClaimOptions<N extends ProviderName> {
	/** name of the provider to generate signed receipt for */
	name: N
	/**
	 * parameters to verify the provider receipt with
	 */
	params: ProviderParams<N>
	/** additional data for signing */
	context?: string
	/**
	 * secrets that are used to make the API request;
	 * not included in the receipt & cannot be viewed by anyone
	 * outside this client
	 */
	secretParams: ProviderSecretParams<N>
	/**
	 * private key of the owner of the claim.
	 * Used to sign the claim request
	*/
	ownerPrivateKey: string
	/** Pass to resume from a specific step */
	resumeFromStep?: CreateStep
	/** listen for when a certain step is reached */
	didUpdateCreateStep?: (step: CreateStep) => void
	additionalConnectOpts?: TLSConnectionOptions
	makeGrpcClient?: typeof createGrpcWebClient

	logger?: Logger
	zkOperator?: ZKOperator
	beacon?: Beacon
}

/**
 * Create a claim on chain
 * @param param0 parameters to create the claim with
 */
export async function createClaim<Name extends ProviderName>({
	name,
	params,
	secretParams,
	resumeFromStep,
	additionalConnectOpts,
	zkOperator,
	ownerPrivateKey,
	didUpdateCreateStep,
	context = '',
	beacon = makeBeacon(),
	logger = LOGGER,
	makeGrpcClient = createGrpcWebClient,
}: CreateClaimOptions<Name>) {
	if(!providers[name].areValidParams(params)) {
		throw new Error(`Invalid params for provider "${name}"`)
	}

	additionalConnectOpts = {
		...providers[name].additionalClientOptions || {},
		...additionalConnectOpts,
	}

	let witnessHosts: string[]
	let timestampS: number
	let epoch: number
	let claimData: ProviderClaimData

	const claimInfo = {
		provider: name,
		parameters: stringifyClaimParameters(params),
		context,
	}
	const identifier = getIdentifierFromClaimInfo(claimInfo)
	const signatures: string[] = []

	if(!resumeFromStep) {
		const state = await beacon.getState()
		timestampS = unixTimestampSeconds()
		witnessHosts = fetchWitnessListForClaim(
			state,
			identifier,
			timestampS,
		)
			.map(w => w.url)
		epoch = state.epoch

		didUpdateCreateStep?.({
			name: 'creating',
			timestampS,
			epoch,
			witnessHosts,
		})
	} else {
		epoch = resumeFromStep.epoch
		timestampS = resumeFromStep.timestampS
		if(resumeFromStep.name === 'witness-done') {
			witnessHosts = resumeFromStep.witnessHostsLeft
			claimData = resumeFromStep.claimData!
			signatures.push(...resumeFromStep.signaturesDone)
		} else {
			witnessHosts = resumeFromStep.witnessHosts
		}
	}

	logger = logger.child({ identifier })
	logger.info(
		{ witnessHosts, timestampS, epoch },
		'got witness list, sending requests to witnesses'
	)

	if(!witnessHosts?.length) {
		throw new Error('No witness hosts were provided')
	}

	const providerClaimReq: ProviderClaimRequest = {
		epoch,
		timestampS,
		info: claimInfo,
		ownerProof: undefined,
	}
	providerClaimReq.ownerProof = await makeOwnerProof(providerClaimReq, ownerPrivateKey)

	for(let i = 0;i < witnessHosts.length;i++) {
		const witnessHost = witnessHosts[i]
		logger.trace({ witnessHost }, 'generating signature for oracle host')

		const grpcUrl = witnessHost.startsWith('http:') || witnessHost.startsWith('https:')
			? witnessHost
			: `https://${witnessHost}`
		const { signature, claimData: r } = await generateSignature(grpcUrl)
		claimData = r!

		signatures.push(signature)

		logger.info({ witnessHost }, 'generated signature for oracle host')

		didUpdateCreateStep?.({
			name: 'witness-done',
			timestampS,
			epoch,
			signaturesDone: signatures,
			claimData,
			witnessHostsLeft: witnessHosts.slice(i + 1),
		})
	}

	return {
		identifier,
		claimData: claimData!,
		signatures,
		witnessHosts,
	}

	async function generateSignature(grpcWebUrl: string) {
		// the trailing slash messes up the grpc-web client
		if(grpcWebUrl.endsWith('/')) {
			grpcWebUrl = grpcWebUrl.slice(0, -1)
		}

		const grpcClient = makeGrpcClient(grpcWebUrl, logger)
		const {
			claimData,
			signature,
		} = await generateProviderReceipt({
			name,
			secretParams,
			params,
			requestData: {
				beaconBasedProviderClaimRequest: providerClaimReq,
				receiptGenerationRequest: undefined,
			},
			client: grpcClient,
			additionalConnectOpts,
			logger,
			zkOperator,
		})

		return {
			signature: ethers.utils.hexlify(signature).toLowerCase(),
			claimData
		}
	}
}