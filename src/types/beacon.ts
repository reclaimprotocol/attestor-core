import type { BeaconIdentifier } from '../proto/api'

export type WitnessData = {
	id: string
	url: string
}

export type BeaconState = {
	witnesses: WitnessData[]
	epoch: number
	witnessesRequiredForClaim: number
	nextEpochTimestampS: number
}

export interface Beacon {
	identifier: BeaconIdentifier
	/**
	 * Get the witnesses for the epoch specified
	 * or the current epoch if none is specified
	 */
	getState(epoch?: number): Promise<BeaconState>

	close?(): Promise<void>
}