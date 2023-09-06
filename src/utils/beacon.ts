import { strToUint8Array, uint8ArrayToDataView } from '@reclaimprotocol/tls'
import { ethers } from 'ethers'
import {
	InitialiseSessionRequest_BeaconBasedProviderClaimRequest as ClaimRequest,
} from '../proto/api'
import { SelectedServiceSignature } from '../signatures'
import { Beacon, BeaconState, ClaimInfo, WitnessData } from '../types'
import { getIdentifierFromClaimInfo } from './claims'

/**
 * Compute the list of witnesses that need to be
 * contacted for a claim
 *
 * @param state current beacon state
 * @param identifier params of the claim
 * @param timestampS timestamp of the claim
 */
export function fetchWitnessListForClaim(
	{ witnesses, witnessesRequiredForClaim, epoch }: BeaconState,
	params: string | ClaimInfo,
	timestampS: number,
) {
	const identifier = typeof params === 'string'
		? params
		: getIdentifierFromClaimInfo(params)
	// include the epoch and
	// witnessesRequiredForClaim in the hash
	// so the same claim can be made multiple times
	// with different witnesses
	const completeInput = [
		identifier,
		epoch.toString(),
		witnessesRequiredForClaim.toString(),
		timestampS.toString(),
	]
		.join('\n')
	const completeHashStr = ethers.utils.keccak256(
		strToUint8Array(completeInput)
	)
	const completeHash = ethers.utils.arrayify(completeHashStr)
	const completeHashView = uint8ArrayToDataView(completeHash)
	const witnessesLeft = [...witnesses]
	const selectedWitnesses: WitnessData[] = []
	// we'll use 32 bits of the hash to select
	// each witness
	let byteOffset = 0
	for(let i = 0; i < witnessesRequiredForClaim; i++) {
		const randomSeed = completeHashView.getUint32(byteOffset)
		const witnessIndex = randomSeed % witnessesLeft.length
		const witness = witnessesLeft[witnessIndex]
		selectedWitnesses.push(witness)

		// Remove the selected witness from the list of witnesses left
		witnessesLeft[witnessIndex] = witnessesLeft[witnessesLeft.length - 1]
		witnessesLeft.pop()
		byteOffset = (byteOffset + 4) % completeHash.length
	}

	return selectedWitnesses
}

/**
 * Get the ID (address on chain) from a private key
*/
export async function getWitnessIdFromPrivateKey(privateKey: string) {
	const pubKey = await SelectedServiceSignature.getPublicKey(privateKey)
	const id = await SelectedServiceSignature.getAddress(pubKey)
	return id
}

export async function makeOwnerProof(
	request: ClaimRequest,
	privateKey: string
) {
	const serialised = ClaimRequest
		.encode({ ...request, ownerProof: undefined })
		.finish()
	const signature = await SelectedServiceSignature.sign(
		serialised,
		privateKey
	)
	const address = await SelectedServiceSignature.getAddress(
		await SelectedServiceSignature
			.getPublicKey(privateKey)
	)
	return { signature, address }
}

/**
 * Verify that the person who is wanting to claim
 * actually is making the claim
 */
export async function assertValidClaimOwner(request: ClaimRequest) {
	const { ownerProof } = request
	const serialised = ClaimRequest
		.encode({ ...request, ownerProof: undefined })
		.finish()
	const verified = await SelectedServiceSignature.verify(
		serialised,
		ownerProof!.signature,
		ownerProof!.address
	)
	if(!verified) {
		throw new Error('Invalid claim owner signature')
	}
}

export function makeBeaconCacheable(beacon: Beacon): Beacon {
	const cache: { [epochId: number]: Promise<BeaconState> } = {}

	return {
		...beacon,
		async getState(epochId) {
			if(!epochId) {
				// TODO: add cache here
				const state = await beacon.getState()
				return state
			}

			const key = epochId
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			if(!cache[key]) {
				cache[key] = beacon.getState(epochId)
			}

			return cache[key]
		},
	}
}