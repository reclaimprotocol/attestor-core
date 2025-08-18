import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto'
import { mock } from 'node:test'
import '#src/server/utils/config-env.ts'

import { preparePacketsForReveal } from '#src/utils/prepare-packets.ts'

setCryptoImplementation(webcryptoCrypto)

/**
 * Spies on the preparePacketsForReveal function
 */
export const SPY_PREPARER = mock.fn(preparePacketsForReveal)

mock.module('#src/utils/prepare-packets.ts', {
	namedExports: {
		preparePacketsForReveal: SPY_PREPARER
	}
})

mock.module('#src/server/utils/apm.ts', {
	namedExports: {
		getApm: mock.fn()
	}
})