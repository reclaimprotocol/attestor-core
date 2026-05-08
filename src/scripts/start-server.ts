import '#src/server/utils/config-env.ts'

import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto'

import { getApm } from '#src/server/utils/apm.ts'
getApm()

setCryptoImplementation(webcryptoCrypto)

async function main() {
	if(process.env.ENCLAVE_MODE === 'true') {
		// Must run before #src/server/index.ts is imported: the server modules
		// read PRIVATE_KEY at module load, so secrets need to be on
		// process.env before that import resolves.
		const { bootstrapTee } = await import('#src/server/tee/bootstrap.ts')
		await bootstrapTee()
	}

	// importing dynamically to allow APM to inject
	// into modules before they are used
	const { createServer } = await import('#src/server/index.ts')
	return createServer()
}

main()