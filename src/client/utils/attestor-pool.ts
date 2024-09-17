import { AttestorClient } from 'src/client/utils/client-socket'
import { IAttestorClient, IAttestorClientCreateOpts } from 'src/types'

const POOL: { [url: string]: IAttestorClient | undefined } = {}

/**
 * Get a attestor client from the pool,
 * if it doesn't exist, create one.
 */
export function getAttestorClientFromPool(
	url: string | URL,
	getCreateOpts: () => Omit<IAttestorClientCreateOpts, 'url'> = () => ({})
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
			'creating new client'
		)
		client = (POOL[key] = new AttestorClient({ ...createOpts, url }))
	}

	return client!
}