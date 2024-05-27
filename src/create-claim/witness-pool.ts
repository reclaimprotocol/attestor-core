import { WitnessClient } from '../client'
import { IWitnessClient, IWitnessClientCreateOpts } from '../types'

const POOL: { [url: string]: IWitnessClient } = {}

/**
 * Get a witness client from the pool,
 * if it doesn't exist, create one.
 */
export function getWitnessClientFromPool(
	url: string | URL,
	createOpts: Omit<IWitnessClientCreateOpts, 'url'> = {}
) {
	const key = url.toString()
	if(!POOL[key]) {
		POOL[key] = new WitnessClient({ ...createOpts, url })
	}

	return POOL[key]
}