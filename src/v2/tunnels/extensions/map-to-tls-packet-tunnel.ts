import { makeMessageProcessor } from '@reclaimprotocol/tls'
import { TLSPacket } from '../../../proto/api'
import { logger as LOGGER } from '../../../utils/logger'
import { MakeTunnelBaseOpts, MakeTunnelFn } from '../../types'

/**
 * Takes a tunnel that sends and receives Uint8Array messages
 * and maps it to be a tunnel that sends and receives TLSPackets.
 */
export const mapToTlsPacketTunnel = <O>(
	makeTunnel: MakeTunnelFn<Uint8Array, O>
): MakeTunnelFn<TLSPacket, O> => {
	return async({ onMessage, logger = LOGGER, ...opts }) => {
		const processor = makeMessageProcessor(logger)
		const tunnel = await makeTunnel({
			...opts as MakeTunnelBaseOpts<Uint8Array, O>,
			onMessage(data) {
				processor.onData(data, (_, pkt) => onMessage?.({
					recordHeader: pkt.header,
					content: pkt.content
				}))
			},
		})

		return {
			...tunnel,
			async write(packet) {
				await tunnel.write(packet.recordHeader)
				await tunnel.write(packet.content)
			}
		}
	}
}