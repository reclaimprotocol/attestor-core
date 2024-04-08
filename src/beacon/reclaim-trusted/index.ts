import { BeaconType } from '../../proto/api'
import { Beacon } from '../../types'
import CONFIG from './config.json'

export function makeReclaimTrustedBeacon(id: string): Beacon {
	if(CONFIG.id !== id) {
		throw new Error(`Invalid reclaim trusted beacon id: ${id}`)
	}

	return {
		identifier: {
			type: BeaconType.BEACON_TYPE_RECLAIM_TRUSTED,
			id,
		},
		getState() {
			return {
				witnesses: [CONFIG],
				epoch: 1,
				witnessesRequiredForClaim: 1,
				nextEpochTimestampS: 0,
			}
		},
	}
}