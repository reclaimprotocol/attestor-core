import { concatenateUint8Arrays, makeTLSClient, TLSConnectionOptions } from '@reclaimprotocol/tls'
import { makeRpcTcpTunnel } from 'src/client/tunnels/make-rpc-tcp-tunnel'
import { DEFAULT_HTTPS_PORT } from 'src/config'
import { CreateTunnelRequest, RPCMessage } from 'src/proto/api'
import { CompleteTLSPacket, IAttestorClient, Logger, MakeTunnelFn, Transcript, Tunnel } from 'src/types'
import { generateRpcMessageId, generateTunnelId } from 'src/utils'

type ExtraTLSOptions = {
	request: Partial<CreateTunnelRequest>
	logger: Logger
	/**
	 * Either create a client with the given initMessages,
	 * or simply send the messages to the server via an existing
	 * client
	 *
	 * @returns the client that was used to send the messages
	 */
	connect(initMessages: Partial<RPCMessage>[]): IAttestorClient
	tlsOpts?: TLSConnectionOptions
}

type TLSTunnelProperties = {
	transcript: Transcript<CompleteTLSPacket>
	tls: ReturnType<typeof makeTLSClient>
}

/**
 * Makes a TLS tunnel that connects to the server via RPC protocol
 */
export const makeRpcTlsTunnel: MakeTunnelFn<ExtraTLSOptions, TLSTunnelProperties> = async({
	onMessage, onClose,
	tlsOpts, request,
	connect, logger
}) => {
	const transcript: TLSTunnelProperties['transcript'] = []
	const tunnelId = request.id || generateTunnelId()
	let tunnel: Tunnel<{}>
	let client: IAttestorClient | undefined

	let handshakeResolve: ((value: void) => void) | undefined
	let handshakeReject: ((reason: any) => void) | undefined
	const waitForHandshake = new Promise<void>((resolve, reject) => {
		handshakeResolve = resolve
		handshakeReject = reject
	})

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
		onTlsEnd: onConnectionClose,
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
				const createTunnelReqId = generateRpcMessageId()
				client = await connect([
					{
						id: createTunnelReqId,
						createTunnelRequest: {
							host: request.host || '',
							port: request.port || DEFAULT_HTTPS_PORT,
							geoLocation: request.geoLocation || '',
							id: tunnelId
						},
					},
					{ tunnelMessage: { tunnelId, message } }
				])
				try {
					await makeTunnel()
					// wait for tunnel to be successfully created
					await client.waitForResponse(createTunnelReqId)
				} catch(err) {
					onConnectionClose(err)
				}

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
	await waitForHandshake

	handshakeResolve = handshakeReject = undefined

	return {
		transcript,
		tls,
		write(data) {
			return tls.write(data)
		},
		async close(err) {
			onConnectionClose(err)
			try {
				await tunnel.close(err)
			} catch(err) {
				logger?.error({ err }, 'err in close tunnel')
			}
		},
	}

	function onConnectionClose(err: Error | undefined) {
		onClose?.(err)
		// once the TLS connection is closed, we no longer
		// want to send `onClose` events back to the caller
		// of this function.
		onClose = undefined
		handshakeReject?.(err)
	}

	async function makeTunnel() {
		tunnel = await makeRpcTcpTunnel({
			tunnelId,
			client: client!,
			onMessage(data) {
				tls.handleReceivedBytes(data)
			},
			onClose(err) {
				void tls.end(err)
			},
		})

		logger?.debug('plaintext tunnel created')

		return tunnel
	}
}