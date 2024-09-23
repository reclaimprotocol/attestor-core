import type { preparePacketsForReveal } from 'src/utils/prepare-packets'

/**
 * Spies on the preparePacketsForReveal function
 */
export const SPY_PREPARER = jest.fn<
	ReturnType<typeof preparePacketsForReveal>,
	Parameters<typeof preparePacketsForReveal>
>()

jest.mock('../utils/prepare-packets', () => {
	const actual = jest.requireActual('../utils/prepare-packets')
	SPY_PREPARER.mockImplementation(actual.preparePacketsForReveal)
	return {
		__esModule: true,
		...actual,
		preparePacketsForReveal: SPY_PREPARER
	}
})

jest.mock('../server/utils/apm', () => {
	return {
		__esModule: true,
		getApm: jest.fn()
	}
})
