import { createClaimOnAttestor as _createClaimOnAttestor, getAttestorClientFromPool } from 'src/client'
import { AttestorClient } from 'src/client'
import { CreateClaimOnMechainOpts } from 'src/mechain/types'
import { ClaimTunnelResponse } from 'src/proto/api'
import { ProviderName } from 'src/types'

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

	await clientMechain.waitForInit()

	onStep?.({ type: 'taskRequested', timestamp })

	const { taskId, requiredAttestors, hosts } = await clientMechain.rpc('createTaskOnMechain', {
		timestamp: timestamp
	})

	onStep?.({ type: 'taskCreated', taskId })

	const responses: ClaimTunnelResponse [] = []

	for(let i = 0; i < requiredAttestors; i++) {

		onStep?.({ type: 'attestorRequested', host: hosts[i] })

		const client = new AttestorClient({
			url: hosts[i]
		})

		const claimTunnelRes = await createClaimOnAttestor ({
			...opts,
			client
		})

		responses.push(claimTunnelRes)
	}

	return { taskId, responses }

}
