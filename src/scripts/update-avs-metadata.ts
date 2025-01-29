// eslint-disable-next-line simple-import-sort/imports
import 'src/server/utils/config-env'
import { getContracts } from 'src/avs/utils/contracts'
import { getCliArgument } from 'src/scripts/utils'

async function main() {
	const { contract } = getContracts()

	const minSignaturesPerTask = getCliArgument('minSignaturesPerTask')
	if(!minSignaturesPerTask) {
		throw new Error(
			'Provide operator address via --minSignaturesPerTask <num>'
		)
	}

	const tx = await contract.updateTaskCreationMetadata({
		minSignaturesPerTask: +(minSignaturesPerTask || 0),
		maxTaskCreationDelayS: 0,
		maxTaskLifetimeS: 0,
	})
	await tx.wait()

	console.log('Updated task creation metadata')
}

void main()