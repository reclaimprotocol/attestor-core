import { createClaimOnAttestor as _createClaimOnAttestor, getAttestorClientFromPool } from 'src/client'
import { AttestorClient } from 'src/client'
import { CreateClaimOnMechainOpts } from 'src/mechain/types'
import { ProviderName } from 'src/types'
import { CreateClaimResponse } from 'src/window-rpc'
import { mapToCreateClaimResponse } from 'src/window-rpc/utils'

/**
 * Creates a Reclaim claim on the AVS chain.
 */
export async function createClaimOnMechain<N extends ProviderName>({
	createClaimOnAttestor = _createClaimOnAttestor,
	onStep,
	client,
	...opts
}: CreateClaimOnMechainOpts<N>) {


	const clientMechain = getAttestorClientFromPool(client.url)

	const timestamp = Math.floor(Date.now() / 1000)

	const { taskId, requiredAttestors, hosts } = await clientMechain.rpc('createTaskOnChain', {
		timestamp: timestamp
	})

	const responses: CreateClaimResponse [] = []

	for(let i = 0; i < requiredAttestors; i++) {

		onStep?.({ type: 'attestorFetched', data: hosts[i] })

		const client = new AttestorClient({
			url: hosts[i]
		})

		const claimTunnelRes = await createClaimOnAttestor ({
			...opts,
			client
		})

		const response = mapToCreateClaimResponse(
			claimTunnelRes
		)
		responses.push(response)
	}


	onStep?.({ type: 'taskCreated', data: taskId })

	return { taskId, responses }

}
