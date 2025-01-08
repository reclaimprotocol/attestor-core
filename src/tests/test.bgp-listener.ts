import type { BGPListener } from 'src/types'
import { logger } from 'src/utils/logger'

jest.mock('../utils/ws', () => {
	return {
		makeWebSocket() {
			mockWs = new MockWS()
			return mockWs
		}
	}
})

import { delay } from 'src/tests/utils'
import { createBgpListener } from 'src/utils/bgp-listener'

describe('BGP Listener', () => {

	let listener: BGPListener
	beforeEach(async() => {
		listener = createBgpListener(logger)
		await delay(10)

		mockWs.onopen()
	})

	afterEach(() => {
		listener.close()
		expect(mockWs.close).toHaveBeenCalled()
	})

	it('should listen for BGP announcements', async() => {
		expect(mockWs.send).toHaveBeenCalled()
	})

	it('should callback on BGP announcement overlap', async() => {
		const MOCK_CALLBACK = jest.fn()
		const cancel = listener.onOverlap(['43.240.13.21'], MOCK_CALLBACK)

		mockWs.onmessage(MOCK_MSG_EVENT)

		expect(MOCK_CALLBACK).toHaveBeenCalled()

		cancel()

		mockWs.onmessage(MOCK_MSG_EVENT)

		expect(MOCK_CALLBACK).toHaveBeenCalledTimes(1)
	})

	it('should not callback on BGP announcement if no overlap', async() => {
		const MOCK_CALLBACK = jest.fn()
		listener.onOverlap(['44.240.13.21'], MOCK_CALLBACK)

		mockWs.onmessage(MOCK_MSG_EVENT)

		expect(MOCK_CALLBACK).not.toHaveBeenCalled()
	})
})

let mockWs: MockWS

class MockWS {
	constructor() {}
	onopen: () => void
	onmessage: (msg: MessageEvent) => void
	send = jest.fn()
	close = jest.fn()
}

const MOCK_ANNOUNCEMENT_MSG = {
	'type': 'ris_message',
	'data': {
		'timestamp': 1736308898.1,
		'peer': '192.65.185.3',
		'peer_asn': '513',
		'id': '192.65.185.3-0194441339340000',
		'host': 'rrc04.ripe.net',
		'type': 'UPDATE',
		'path': [
			513,
			29222,
			29222,
			3303,
			3356,
			3223,
			55933,
			55933
		],
		'community': [
			[
				513,
				29222
			],
			[
				3223,
				2
			],
			[
				3223,
				202
			],
			[
				3223,
				666
			],
			[
				3303,
				1004
			],
			[
				3303,
				1006
			],
			[
				3303,
				3052
			],
			[
				3356,
				2
			],
			[
				3356,
				22
			],
			[
				3356,
				100
			],
			[
				3356,
				123
			],
			[
				3356,
				501
			],
			[
				3356,
				901
			],
			[
				3356,
				2065
			],
			[
				3356,
				10725
			],
			[
				22222,
				1299
			],
			[
				22233,
				10022
			],
			[
				22233,
				10030
			],
			[
				22233,
				10060
			],
			[
				29222,
				100
			],
			[
				29222,
				3303
			]
		],
		'origin': 'INCOMPLETE',
		'announcements': [
			{
				'next_hop': '192.65.185.3',
				'prefixes': [
					'43.240.13.0/24'
				]
			}
		],
		'withdrawals': []
	}
}

const MOCK_MSG_EVENT = new MessageEvent(
	'message',
	{ data: JSON.stringify(MOCK_ANNOUNCEMENT_MSG) }
)