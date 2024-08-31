import '../server/utils/config-env'
import { getContracts } from '../avs/utils/contracts'

async function main() {
	const { wallet, contract } = getContracts()
	console.log(`Checking registration for operator ${wallet.address}`)
	const operatorAddr = wallet.address
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

main()