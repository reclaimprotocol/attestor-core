import { WitnessClient } from 'src/client/utils/client-socket'
import { IWitnessClient, IWitnessClientCreateOpts } from 'src/types'

const POOL: { [url: string]: IWitnessClient | undefined } = {}

/**
 * Get a witness client from the pool,
 * if it doesn't exist, create one.
 */
export function getWitnessClientFromPool(
	url: string | URL,
	getCreateOpts: () => Omit<IWitnessClientCreateOpts, 'url'> = () => ({})
) {
	const key = url.toString()
	let client = POOL[key]
	let createReason: string | undefined
	if(client?.isClosed) {
		createReason = 'closed'
	} else if(!client) {
		createReason = 'non-existent'
	}

	if(createReason) {
		const createOpts = getCreateOpts()
		createOpts?.logger?.info(
			{ key, createReason },
			'creating new witness client'
		)
		client = (POOL[key] = new WitnessClient({ ...createOpts, url }))
	}

	return client!
}