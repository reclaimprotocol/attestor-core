import { BeaconIdentifier, BeaconType } from '../proto/api'
import { Beacon } from '../types'
import makeBeacon from './smart-contract'

const BEACON_MAP: Record<string, Beacon> = {}

const BEACON_TYPE_MAP: Record<BeaconType, (id: string) => Beacon> = {
	[BeaconType.BEACON_TYPE_SMART_CONTRACT]: makeBeacon,
	[BeaconType.BEACON_TYPE_UNKNOWN]: () => {
		throw new Error('Unknown beacon type')
	},
	[BeaconType.UNRECOGNIZED]: () => {
		throw new Error('Unrecognized beacon type')
	}
}

/**
 * Get the beacon for a given identifier
 */
export function getBeacon(identifier: BeaconIdentifier) {
	const uqId = `${identifier.type}-${identifier.id}`
	if(BEACON_MAP[uqId]) {
		return BEACON_MAP[uqId]
	}

	const beacon = BEACON_TYPE_MAP[identifier.type](identifier.id)
	BEACON_MAP[uqId] = beacon

	return beacon
}