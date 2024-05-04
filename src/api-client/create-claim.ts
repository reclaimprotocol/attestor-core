import type { TLSConnectionOptions } from '@reclaimprotocol/tls'
import { ethers } from 'ethers'
import { getBeacon } from '../beacon'
import { DEFAULT_BEACON_IDENTIFIER } from '../config'
import { InitialiseSessionRequest_BeaconBasedProviderClaimRequest as ProviderClaimRequest, ProviderClaimData } from '../proto/api'
import { ProviderName, ProviderParams, providers, ProviderSecretParams } from '../providers'
import { Beacon, CreateStep, Logger, WitnessData } from '../types'
import { createGrpcWebClient, fetchWitnessListForClaim, getIdentifierFromClaimInfo, logger as LOGGER, makeOwnerProof, PrepareZKProofsBaseOpts, stringifyClaimParameters, unixTimestampSeconds } from '../utils'
import { generateProviderReceipt } from './generate-provider-receipt'

export type CreateClaimOptions<N extends ProviderName> = {
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
	beacon?: Beacon
} & PrepareZKProofsBaseOpts

/**
 * Create a claim on chain
 * @param param0 parameters to create the claim with
 */
export async function createClaim<Name extends ProviderName>({
	name,
	params,
	secretParams,
	resumeFromStep,
	ownerPrivateKey,
	didUpdateCreateStep,
	context = '',
	beacon = getBeacon(DEFAULT_BEACON_IDENTIFIER),
	logger = LOGGER,
	makeGrpcClient = createGrpcWebClient,
	...opts
}: CreateClaimOptions<Name>) {
	if(!providers[name].areValidParams(params)) {
		throw new Error(`Invalid params for provider "${name}"`)
	}

	let witnesses: WitnessData[]
	let timestampS: number
	let epoch: number
	let claimData: ProviderClaimData

	const claimInfo = {
		provider: name,
		parameters: stringifyClaimParameters(params),
		context,
	}
	let identifier = getIdentifierFromClaimInfo(claimInfo)
	const signatures: string[] = []

	if(!resumeFromStep) {
		const state = await beacon.getState()
		timestampS = unixTimestampSeconds()
		witnesses = fetchWitnessListForClaim(
			state,
			identifier,
			timestampS,
		)
		epoch = state.epoch

		didUpdateCreateStep?.({
			name: 'creating',
			timestampS,
			epoch,
			witnessHosts: witnesses.map(w => w.url),
			witnesses
		})
	} else {
		epoch = resumeFromStep.epoch
		timestampS = resumeFromStep.timestampS
		if(resumeFromStep.name === 'witness-done') {
			witnesses = resumeFromStep.witnessesLeft
			claimData = resumeFromStep.claimData!
			signatures.push(...resumeFromStep.signaturesDone)
		} else {
			witnesses = resumeFromStep.witnesses
		}
	}

	logger = logger.child({ identifier })
	logger.info(
		{ witnesses, timestampS, epoch },
		'got witness list, sending requests to witnesses'
	)

	if(!witnesses?.length) {
		throw new Error('No witness hosts were provided')
	}

	const providerClaimReq: ProviderClaimRequest = {
		epoch,
		timestampS,
		info: claimInfo,
		ownerProof: undefined,
		beacon: beacon.identifier,
	}
	providerClaimReq.ownerProof = await makeOwnerProof(
		providerClaimReq,
		ownerPrivateKey
	)

	for(let i = 0;i < witnesses.length;i++) {
		const witness = witnesses[i]
		logger.trace({ witness }, 'generating signature for oracle host')

		const { signature, claimData: r } = await generateSignature(witness)
		claimData = r!
		identifier = claimData.identifier
		logger.info({ identifier }, 'new identifier')

		signatures.push(signature)

		logger.info({ witness }, 'generated signature for oracle host')

		const witnessesLeft = witnesses.slice(i + 1)
		didUpdateCreateStep?.({
			name: 'witness-done',
			timestampS,
			epoch,
			signaturesDone: signatures,
			claimData,
			witnessesLeft,
			witnessHostsLeft: witnessesLeft.map(w => w.url),
		})
	}

	return {
		identifier,
		claimData: claimData!,
		signatures,
		witnesses,
	}

	async function generateSignature(witness: WitnessData) {
		let { url: grpcWebUrl } = witness
		grpcWebUrl = grpcWebUrl.startsWith('http:') || grpcWebUrl.startsWith('https:')
			? grpcWebUrl
			: `https://${grpcWebUrl}`
		// the trailing slash messes up the grpc-web client
		if(grpcWebUrl.endsWith('/')) {
			grpcWebUrl = grpcWebUrl.slice(0, -1)
		}

		const grpcClient = makeGrpcClient(grpcWebUrl)
		const {
			claimData,
			signature,
		} = await generateProviderReceipt({
			name,
			secretParams,
			params,
			beaconBasedProviderRequest: providerClaimReq,
			client: grpcClient,
			logger,
			onStep(step) {
				didUpdateCreateStep?.({
					name: 'witness-progress',
					timestampS,
					epoch,
					witnesses,
					witnessHosts: [],
					currentWitness: witness,
					step,
				})
			},
			...opts
		})

		return {
			signature: ethers.utils.hexlify(signature).toLowerCase(),
			claimData
		}
	}
}