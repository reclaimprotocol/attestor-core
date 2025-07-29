import { mock } from 'node:test'

import { preparePacketsForReveal } from '#src/utils/prepare-packets.ts'

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