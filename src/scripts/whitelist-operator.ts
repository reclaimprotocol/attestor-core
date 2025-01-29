// eslint-disable-next-line simple-import-sort/imports
import 'src/server/utils/config-env'
import { getContracts } from 'src/avs/utils/contracts'
import { getCliArgument } from 'src/scripts/utils'

async function main() {
	const { contract } = getContracts()

	const address = getCliArgument('address')
	if(!address) {
		throw new Error(
			'Provide operator address via --address <addr>'
		)
	}

	const tx = await contract.whitelistAddressAsOperator(address, true)
	await tx.wait()

	console.log('Whitelisted address:', address)
}

void main()