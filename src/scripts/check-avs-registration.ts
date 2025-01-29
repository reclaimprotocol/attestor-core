// eslint-disable-next-line simple-import-sort/imports
import 'src/server/utils/config-env'
import { getContracts } from 'src/avs/utils/contracts'


async function main() {
	const { wallet, contract } = getContracts()

	const meta = await contract.taskCreationMetadata()
	console.log(
		'Metadata parameters:',
		`maxTaskCreationDelayS: ${meta.maxTaskCreationDelayS}`,
		`minSignaturesPerTask: ${meta.minSignaturesPerTask}`,
		`maxTaskLifetimeS: ${meta.maxTaskLifetimeS}`,
	)

	console.log(`Checking registration for operator ${wallet!.address}`)
	const operatorAddr = wallet!.address
	const metadata = await contract.getMetadataForOperator(operatorAddr)
		.catch(err => {
			if(err.message.includes('Operator not found')) {
				return
			}

			throw err
		})
	if(!metadata) {
		console.log('Operator not registered')
		const isWhitelisted = await contract
			.isOperatorWhitelisted(operatorAddr)
		console.log(`Is whitelisted: ${isWhitelisted}`)
		return
	}

	console.log('Operator registered, URL:', metadata.url)
}

void main()