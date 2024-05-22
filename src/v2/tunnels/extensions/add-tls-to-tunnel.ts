import { concatenateUint8Arrays, makeTLSClient, TLSConnectionOptions } from '@reclaimprotocol/tls'
import { CreateTunnelRequest } from '../../../proto/api'
import { MakeTunnelFn, Tunnel } from '../../types'

type ExtraTLSOptions = {
	tlsOpts: TLSConnectionOptions
}

/**
 * Adds TLS to an existing plaintext tunnel.
 */
export const addTlsToTunnel = <O extends { request: Partial<CreateTunnelRequest> }>(
	makePlaintextTunnel: MakeTunnelFn<Uint8Array, O>
): MakeTunnelFn<Uint8Array, O & ExtraTLSOptions> => {
	return async({ onMessage, onClose, logger, request, tlsOpts, ...opts }) => {
		let tunnel: Tunnel<Uint8Array>

		let handshakeResolve: ((value: void) => void) | undefined
		let handshakeReject: ((reason: any) => void) | undefined
		const tls = makeTLSClient({
			host: request.host!,
			...tlsOpts,
			logger,
			onHandshake() {
				handshakeResolve?.()
			},
			onApplicationData(plaintext) {
				return onMessage?.(plaintext)
			},
			onTlsEnd(err) {
				onClose?.(err)
				tunnel.close(err)
				handshakeReject?.(err)
			},
			async write(packet) {
				const message = concatenateUint8Arrays([
					packet.header,
					packet.content
				])
				if(!tunnel) {
					// sends the packet as the initial message
					// to the plaintext tunnel. Prevents another
					// round trip to the server as we send the packet
					// in the same message as the tunnel creation.
					request.initialMessage = message
					await makeTunnel()
					return
				}

				return tunnel.write(message)
			}
		})

		await tls.startHandshake()
		// wait for handshake completion
		await new Promise<void>((resolve, reject) => {
			handshakeResolve = resolve
			handshakeReject = reject
		})

		handshakeResolve = handshakeReject = undefined

		return {
			write(data) {
				return tls.write(data)
			},
			async close(err) {
				await tls.end(err)
			},
		}

		async function makeTunnel() {
			tunnel = await makePlaintextTunnel({
				...opts as unknown as O,
				request,
				logger,
				onMessage(data) {
					tls.handleReceivedBytes(data)
				},
				onClose(err) {
					tls.end(err)
				},
			})

			logger?.info('plaintext tunnel created')

			return tunnel
		}
	}
}