import assert from 'node:assert'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { delay } from '#src/tests/utils.ts'
import type { BGPListener } from '#src/types/index.ts'

mock.module('#src/utils/ws.ts', {
	namedExports: {
		makeWebSocket() {
			mockWs = new MockWS()
			return mockWs
		}
	}
})

describe('BGP Listener', () => {

	let listener: BGPListener
	beforeEach(async() => {
		// dynamic import to let the mock take effect
		const { createBgpListener, logger } = await import('#src/utils/index.ts')
		listener = createBgpListener(logger)
		await delay(10)

		mockWs.onopen()
	})

	afterEach(() => {
		listener.close()
		assert.ok(mockWs.close.mock.callCount())
	})

	it('should listen for BGP announcements', async() => {
		assert.ok(mockWs.send.mock.callCount())
	})

	it('should callback on BGP announcement overlap', async() => {
		const MOCK_CALLBACK = mock.fn()
		const cancel = listener.onOverlap(['43.240.13.21'], MOCK_CALLBACK)

		mockWs.onmessage(MOCK_MSG_EVENT)

		assert.ok(MOCK_CALLBACK.mock.callCount())

		cancel()

		mockWs.onmessage(MOCK_MSG_EVENT)

		assert.equal(MOCK_CALLBACK.mock.callCount(), 1)
	})

	it('should not callback on BGP announcement if no overlap', async() => {
		const MOCK_CALLBACK = mock.fn()
		listener.onOverlap(['44.240.13.21'], MOCK_CALLBACK)

		mockWs.onmessage(MOCK_MSG_EVENT)

		assert.ok(!MOCK_CALLBACK.mock.callCount())
	})

	for(const { prefix, ip, expected } of [
		{ prefix: '43.240.13.0/24', ip: '43.240.13.0', expected: true },
		{ prefix: '43.240.13.0/24', ip: '43.240.13.255', expected: true },
		{ prefix: '43.240.13.0/24', ip: '43.240.14.0', expected: false },
		{ prefix: '2001:db8::/32', ip: '2001:db8:abcd::1', expected: true },
		{ prefix: '2001:db8::/32', ip: '2001:db9::1', expected: false },
		{ prefix: '::/64', ip: '0.0.0.1', expected: false },
		{ prefix: '0.0.0.0/24', ip: '::1', expected: false },
		{ prefix: '43.240.13.0/24', ip: '::ffff:43.240.13.21', expected: true },
		{ prefix: '0.0.0.0/0', ip: '43.240.13.21', expected: false },
		{ prefix: '::/0', ip: '2001:db8::1', expected: false },
		{ prefix: '43.240.13.0/24', ip: '043.240.13.21', expected: false },
		{ prefix: '43.240.13.0/24', ip: 'invalid', expected: false },
		{ prefix: 'invalid/24', ip: '43.240.13.21', expected: false },
		{ prefix: '43.240.13.21', ip: '43.240.13.21', expected: false },
	]) {
		it(`matches ${ip} against ${prefix}: ${expected}`, () => {
			const callback = mock.fn()
			listener.onOverlap([ip], callback)
			mockWs.onmessage(new MessageEvent('message', {
				data: JSON.stringify({ data: { announcements: [{ prefixes: [prefix], 'next_hop': '192.0.2.1' }] } })
			}))
			assert.equal(callback.mock.callCount(), expected ? 1 : 0)
		})
	}
})

let mockWs: MockWS

class MockWS {
	constructor() {}
	onopen: () => void
	onmessage: (msg: MessageEvent) => void
	send = mock.fn()
	close = mock.fn()
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
