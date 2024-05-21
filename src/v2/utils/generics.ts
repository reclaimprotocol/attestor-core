import { crypto, uint8ArrayToDataView } from '@reclaimprotocol/tls'
import { RPCEvent, RPCEventMap, RPCEventType } from '../types'

export function generateRpcMessageId() {
	return uint8ArrayToDataView(
		crypto.randomBytes(8)
	).getUint32(0)
}

export function makeRpcEvent<T extends RPCEventType>(
	type: T,
	data: RPCEventMap[T]
) {
	const ev = new Event(type) as RPCEvent<T>
	ev.data = data
	return ev
}