import { Address4, Address6 } from 'ip-address'
import type { Logger } from 'pino'

import { BGP_WS_URL } from '#src/config/index.ts'
import type { BGPAnnouncementOverlapData, BGPListener } from '#src/types/index.ts'
import { makeWebSocket } from '#src/utils/ws.ts'

const ANNOUNCEMENT_OVERLAP = 'announcement-overlap'

class BGPAnnouncementOverlapEvent extends Event {

	readonly data: BGPAnnouncementOverlapData

	constructor(data: BGPAnnouncementOverlapData) {
		super(ANNOUNCEMENT_OVERLAP)
		this.data = data
	}
}

/**
 * Listens for BGP announcements and emits events whenever
 * an announcement overlaps with a target IP.
 */
export function createBgpListener(logger: Logger): BGPListener {
	let ws: ReturnType<typeof makeWebSocket>
	let closed = false

	const targetIps = new Set<string>()
	const eventTarget = new EventTarget()

	openWs()

	return {
		onOverlap(ips, callback) {
			for(const ip of ips) {
				targetIps.add(ip)
			}

			eventTarget.addEventListener(
				ANNOUNCEMENT_OVERLAP,
				_callback
			)

			return () => {
				for(const ip of ips) {
					targetIps.delete(ip)
				}

				eventTarget.removeEventListener(
					ANNOUNCEMENT_OVERLAP,
					_callback
				)
			}

			function _callback(event: BGPAnnouncementOverlapEvent) {
				callback(event.data)
			}
		},
		close() {
			ws.onclose = null
			ws.onerror = null
			ws.close()
			closed = true
		}
	}

	function openWs() {
		logger.debug('connecting to BGP websocket')

		ws = makeWebSocket(BGP_WS_URL)
		ws.onopen = onOpen
		ws.onerror = (ev) => onClose(ev)
		ws.onclose = () => onClose(new Error('Unexpected close'))
		ws.onmessage = ({ data }) => {
			const str = typeof data === 'string' ? data : data.toString()
			try {
				onMessage(str)
			} catch(err) {
				logger.error({ data, err }, 'error processing BGP message')
			}
		}
	}

	function onOpen(): void {
		const subscriptionMessage = {
			type: 'ris_subscribe',
			data: {
				type: 'UPDATE',
			},
		}
		ws.send(JSON.stringify(subscriptionMessage))

		logger.info('connected to BGP websocket')
	}

	function onClose(err?: Error | Event) {
		if(closed) {
			return
		}

		logger.info({ err }, 'BGP websocket closed')
		if(!err) {
			return
		}

		logger.info('reconnecting to BGP websocket')
		openWs()
	}

	function onMessage(message: string): void {
		const data = JSON.parse(message)
		const announcements = data?.data?.announcements

		logger.trace({ data }, 'got BGP update')

		if(!Array.isArray(announcements)) {
			return
		}

		const asPath = data?.data?.path

		for(const announcement of announcements) {
			const prefixes = announcement?.prefixes
			const nextHop = announcement?.['next_hop']

			const hasPrefixes = prefixes?.length && (nextHop || asPath)
			if(!hasPrefixes) {
				return
			}

			for(const prefix of prefixes) {
				if(!overlapsTargetIps(prefix)) {
					continue
				}

				// emit event
				eventTarget.dispatchEvent(
					new BGPAnnouncementOverlapEvent({ prefix })
				)
			}
		}
	}

	function overlapsTargetIps(prefix: string): boolean {
		if(!prefix.includes('/')) {
			throw new Error('Invalid CIDR address')
		}

		// ignore all prefixes that end with /0
		if(prefix.endsWith('/0')) {
			return false
		}

		const cidr = parseAddress(prefix)
		for(const ip of targetIps) {
			try {
				if(parseAddress(ip).isInSubnet(cidr)) {
					return true
				}
			} catch {
				// Invalid target IPs cannot overlap an announcement.
			}
		}

		return false
	}
}

function parseAddress(value: string): Address4 | Address6 {
	const address = value.includes(':')
		? new Address6(value)
		: new Address4(value)
	return address instanceof Address6 && address.v4 && address.address4
		? address.address4
		: address
}
