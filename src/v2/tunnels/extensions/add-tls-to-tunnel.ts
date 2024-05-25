import { concatenateUint8Arrays, makeTLSClient, TLSConnectionOptions } from '@reclaimprotocol/tls'
import { CreateTunnelRequest } from '../../../proto/api'
import { CompleteTLSPacket } from '../../../types'
import { MakeTunnelFn, Transcript, Tunnel } from '../../types'

type ExtraTLSOptions = {
	tlsOpts: TLSConnectionOptions
}

type ExtraTLSTunnelData = {
	transcript: Transcript<CompleteTLSPacket>
	tls: ReturnType<typeof makeTLSClient>
}

/**
 * Adds TLS to an existing plaintext tunnel.
 */
export const addTlsToTunnel = <O extends { request: Partial<CreateTunnelRequest> }>(
	makePlaintextTunnel: MakeTunnelFn<O>
): MakeTunnelFn<O & ExtraTLSOptions, ExtraTLSTunnelData> => {
	return async({ onMessage, onClose, logger, request, tlsOpts, ...opts }) => {
		const transcript: ExtraTLSTunnelData['transcript'] = []
		let tunnel: Tunnel<{}>

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
				// once the TLS connection is closed, we no longer
				// want to send `onClose` events back to the caller
				// of this function.
				onClose = undefined

				tunnel.close(err)
				handshakeReject?.(err)
			},
			async write(packet, ctx) {
				const message = concatenateUint8Arrays([
					packet.header,
					packet.content
				])
				transcript.push({
					sender: 'client',
					message: { ...ctx, data: message }
				})

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
			},
			onRead(packet, ctx) {
				transcript.push({
					sender: 'server',
					message: {
						...ctx,
						data: concatenateUint8Arrays([
							packet.header,
							// the TLS package sends us the decrypted
							// content, so we need to get the orginal
							// ciphertext received from the server
							// as that's part of the true transcript.
							ctx.type === 'ciphertext'
								? ctx.ciphertext
								: packet.content
						])
					}
				})
			},
		})

		await tls.startHandshake()
		// wait for handshake completion
		await new Promise<void>((resolve, reject) => {
			handshakeResolve = resolve
			handshakeReject = reject
		})

		handshakeResolve = handshakeReject = undefined

		return {
			transcript,
			tls,
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

			logger?.debug('plaintext tunnel created')

			return tunnel
		}
	}
}