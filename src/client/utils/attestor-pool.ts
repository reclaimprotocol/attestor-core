import { AttestorClient } from '#src/client/utils/client-socket.ts'
import type { IAttestorClient, IAttestorClientCreateOpts } from '#src/types/index.ts'

const POOL: { [url: string]: IAttestorClient | undefined } = {}

/**
 * Get a attestor client from the pool,
 * if it doesn't exist, create one.
 * @param [getCreateOpts] - Function to get the options for creating a new client.
 *  called synchronously, in the same tick as this function.
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