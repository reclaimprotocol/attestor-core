import { BeaconType } from '../../proto/api'
import { Beacon } from '../../types'
import { makeBeaconCacheable } from '../../utils'
import { getContract } from './utils'

export default function makeSmartContractBeacon(chainId: string): Beacon {
	const contract = getContract(chainId)
	return makeBeaconCacheable({
		identifier: {
			type: BeaconType.BEACON_TYPE_SMART_CONTRACT,
			id: chainId.toString()
		},
		async getState(epochId) {
			const epoch = await contract.fetchEpoch(epochId || 0)
			if(!epoch.id) {
				throw new Error(`Invalid epoch ID: ${epochId}`)
			}

			return {
				epoch: epoch.id,
				witnesses: epoch.witnesses.map(w => ({
					id: w.addr.toLowerCase(),
					url: w.host
				})),
				witnessesRequiredForClaim: epoch.minimumWitnessesForClaimCreation,
				nextEpochTimestampS: epoch.timestampEnd
			}
		}
	})
}