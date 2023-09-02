
export const MOCK_BEACON_STATE_FN = jest.fn()

jest.mock('../beacon', () => {
	return {
		__esModule: true,
		makeBeacon() {
			return {
				getState: MOCK_BEACON_STATE_FN
			}
		}
	}
})