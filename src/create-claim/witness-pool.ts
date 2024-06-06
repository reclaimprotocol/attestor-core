import { WitnessClient } from '../client'
import { IWitnessClient, IWitnessClientCreateOpts } from '../types'

const POOL: { [url: string]: IWitnessClient | undefined } = {}

/**
 * Get a witness client from the pool,
 * if it doesn't exist, create one.
 */
export function getWitnessClientFromPool(
	url: string | URL,
	createOpts: Omit<IWitnessClientCreateOpts, 'url'> = {}
) {
	const key = url.toString()
	let client = POOL[key]
	if(client?.isClosed) {
		client = undefined
		createOpts?.logger?.info(
			{ key },
			'client found closed, creating new client...'
		)
	} else if(!client) {
		createOpts?.logger?.info(
			{ key },
			'client not found in pool, creating new client...'
		)
	}

	if(!client) {
		client = (POOL[key] = new WitnessClient({ ...createOpts, url }))
	}

	return client
}