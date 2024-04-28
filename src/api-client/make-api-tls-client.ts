import { detectEnvironment } from '@reclaimprotocol/common-grpc-web-transport'
import { CipherSuite, makeTLSClient, PACKET_TYPE, SUPPORTED_NAMED_CURVES, TLSConnectionOptions, TLSPresharedKey, TLSSessionTicket } from '@reclaimprotocol/tls'
import { FinaliseSessionRequest_Block as BlockReveal, InitialiseSessionRequest, InitialiseSessionRequest_BeaconBasedProviderClaimRequest as BeaconBasedProviderRequest, PullFromSessionResponse, ReclaimWitnessClient, TranscriptMessageSenderType, WitnessVersion } from '../proto/api'
import { ArraySlice, CompleteTLSPacket, Logger } from '../types'
import { getBlocksToReveal, logger as MAIN_LOGGER, PrepareZKProofsBaseOpts, redactSlices } from '../utils'
import { preparePacketsForReveal, PreparePacketsForRevealOpts } from '../utils/prepare-packets'

export type BaseAPIClientOptions = {
	client: ReclaimWitnessClient
	logger?: Logger
	additionalConnectOpts?: TLSConnectionOptions
	beaconBasedProviderRequest?: BeaconBasedProviderRequest
	/**
	 * Default way to redact data sent from the client to the server.
	 * For TLS1.3, this is 'key-update', for TLS1.2, this is 'zk'
	 *
	 * Note: TLS1.2 does not support key update method, zk is
	 * the only way to redact data
	 *
	 * @default 'key-update'
	 */
	defaultWriteRedactionMode?: 'key-update' | 'zk'
} & PrepareZKProofsBaseOpts

export type APITLSClientOptions = BaseAPIClientOptions & {
	host: string
	port: number
	geoLocation?: string
	handleDataFromServer(data: Uint8Array): void
	onTlsEnd?(error?: Error): void
	/** return the sections of the response to redact */
	redactResponse?(data: Uint8Array): ArraySlice[]
}

type ServerAppDataPacket = {
	plaintext: Uint8Array
	index: number
}

// we only support chacha20-poly1305 for API sessions
// that need ZK proofs
const ZK_CIPHER_SUITES: CipherSuite[]
	= [
		// chacha-20
		'TLS_CHACHA20_POLY1305_SHA256',
		'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
		'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
		// aes-256
		'TLS_AES_256_GCM_SHA384',
		'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
		'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
		// aes-128
		'TLS_AES_128_GCM_SHA256',
		'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
		'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
	]

const NAMED_CURVE_LIST = detectEnvironment() === 'node'
	? SUPPORTED_NAMED_CURVES
	// X25519 is not supported in the browser
	: SUPPORTED_NAMED_CURVES.filter(c => c !== 'X25519')

export const makeAPITLSClient = ({
	host,
	port,
	client,
	redactResponse,
	handleDataFromServer,
	onTlsEnd,
	beaconBasedProviderRequest,
	additionalConnectOpts,
	defaultWriteRedactionMode = 'key-update',
	geoLocation = '',
	logger = MAIN_LOGGER?.child({ }),
	...opts
}: APITLSClientOptions) => {
	let sessionId: string | undefined
	let pullFromSessionAbort: AbortController | undefined
	let psk: TLSPresharedKey | undefined
	let metadata: ReturnType<typeof tls.getMetadata>

	const { generateOutOfBandSession } = additionalConnectOpts || {}
	additionalConnectOpts = {
		...additionalConnectOpts || {},
		namedCurves: NAMED_CURVE_LIST,
		cipherSuites: ZK_CIPHER_SUITES
	}

	const allPackets: CompleteTLSPacket[] = []

	let onHandshake: (() => void) | undefined
	const tls = makeTLSClient({
		host,
		logger,
		...additionalConnectOpts,
		onHandshake() {
			metadata = tls.getMetadata()
			onHandshake?.()

			if(metadata?.version === 'TLS1_2') {
				// TLS1.2 does not support key update
				defaultWriteRedactionMode = 'zk'
			}
		},
		onRead(packet, ctx) {
			allPackets.push({
				packet,
				ctx,
				sender: TranscriptMessageSenderType
					.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER,
				index: -1,
			})
		},
		onApplicationData(plaintext) {
			return handleDataFromServer(plaintext)
		},
		onTlsEnd,
		async write(packet, ctx) {
			// send to the witness to forward
			// to the destination server
			const res = await client.pushToSession({
				sessionId: sessionId!,
				messages: [
					{
						recordHeader: packet.header,
						content: packet.content,
						// deprecated, just there for compatibility
						authenticationTag: new Uint8Array(0),
					}
				]
			})

			allPackets.push({
				packet,
				ctx,
				sender: TranscriptMessageSenderType
					.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT,
				index: res.index,
			})

			logger.debug(
				{ length: packet.content.length },
				'pushed data'
			)
		}
	})

	return {
		allPackets,
		generatePSK,
		async connect() {
			if(!psk && generateOutOfBandSession) {
				await generatePSK()
			}

			let initialiseSessionParams: InitialiseSessionRequest
			if(beaconBasedProviderRequest) {
				initialiseSessionParams = {
					beaconBasedProviderClaimRequest: beaconBasedProviderRequest,
					receiptGenerationRequest: undefined
				}
			} else {
				initialiseSessionParams = {
					receiptGenerationRequest: {
						host,
						port,
						geoLocation,
					},
					beaconBasedProviderClaimRequest: undefined
				}
			}

			logger.trace('initialising...')

			const res = await client.initialiseSession(initialiseSessionParams)
			sessionId = res.sessionId
			pullFromSessionAbort = new AbortController()

			logger = logger.child({ sessionId })
			logger.debug('initialised session')

			const pullIterator = client.pullFromSession(
				{
					sessionId,
					version: WitnessVersion.WITNESS_VERSION_1_1_0,
				},
				{ signal: pullFromSessionAbort?.signal }
			)

			logger.debug('pulling from session')

			const evPromise = listenToDataFromServer(
				pullIterator,
				() => {
					logger.debug('session ready')
					tls.startHandshake({ psk })
				}
			)

			await Promise.race([
				evPromise,
				new Promise<void>(resolve => {
					onHandshake = resolve
				})
			])

			if(!tls.isHandshakeDone()) {
				throw new Error('Handshake failed')
			}

			logger.debug({ metadata }, 'handshake done')

			return () => {
				pullFromSessionAbort?.abort()
			}
		},
		async cancel() {
			if(!sessionId) {
				throw new Error('Nothing to cancel')
			}

			pullFromSessionAbort?.abort()
			await client.cancelSession({ sessionId })

			await tls.end()
		},
		/**
		 * Stops listening to the socket
		 */
		async endTlsSession() {
			if(tls.hasEnded()) {
				return
			}

			await tls.end()
			logger.info('ended TLS session')
		},
		/**
		 * Get the blocks with either the raw key to decrypt
		 * or the ZK proof to verify the redacted data. These
		 * can then be sent to the witness to verify the transcript
		 */
		async getBlocksToReveal(
			onZkProgress?: PreparePacketsForRevealOpts['onZkProgress']
		) {
			let serverPacketsToReveal: ReturnType<typeof getBlocksToReveal<ServerAppDataPacket>> = 'all'
			if(redactResponse) {
				const serverBlocks: ServerAppDataPacket[] = []
				for(let i = 0;i < allPackets.length;i++) {
					const b = allPackets[i]
					if(
						b.sender === TranscriptMessageSenderType
							.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
						&& b.ctx.type === 'ciphertext'
						&& isApplicationData(b)
					) {
						serverBlocks.push({
							plaintext: metadata.version === 'TLS1_3'
								? b.ctx.plaintext.slice(0, -1)
								: b.ctx.plaintext,
							index: i,
						})
					}
				}

				serverPacketsToReveal = getBlocksToReveal(
					serverBlocks,
					redactResponse
				)
			}

			if(serverPacketsToReveal === 'all') {
				// reveal all server side blocks
				for(const packet of allPackets) {
					if(packet.sender === TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER) {
						packet.reveal = { type: 'complete' }
					}
				}
			} else {
				for(const packet of serverPacketsToReveal) {
					allPackets[packet.block.index].reveal = {
						type: 'zk',
						redactedPlaintext: packet.redactedPlaintext
					}
				}
			}

			// reveal all client side handshake blocks
			// so the witness can verify there was no
			// hanky-panky
			for(const p of allPackets) {
				if(p.sender !== TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT) {
					continue
				}

				if(p.ctx.type !== 'ciphertext') {
					continue
				}

				// break the moment we hit the first
				// application data packet
				if(isApplicationData(p)) {
					break
				}

				if(defaultWriteRedactionMode === 'zk') {
					p.reveal = {
						type: 'zk',
						redactedPlaintext: p.ctx.plaintext
					}
				} else {
					p.reveal = { type: 'complete' }
				}
			}

			const revealBlocks = await preparePacketsForReveal(
				allPackets,
				{
					logger,
					cipherSuite: metadata.cipherSuite!,
					onZkProgress,
					...opts,
				}
			)

			return revealBlocks
		},
		async finish(revealBlocks: BlockReveal[]) {
			if(!sessionId) {
				throw new Error('Nothing to cancel')
			}

			const result = await client.finaliseSession({
				sessionId,
				revealBlocks,
			})

			await tls.end()
			pullFromSessionAbort?.abort()

			return result
		},
		async write(data: Uint8Array, redactedSections: ArraySlice[]) {
			if(defaultWriteRedactionMode === 'key-update') {
				await writeRedactedWithKeyUpdate()
			} else {
				await writeRedactedZk()
			}

			async function writeRedactedWithKeyUpdate() {
				let currentIndex = 0
				for(let i = 0;i < redactedSections.length;i++) {
					const section = redactedSections[i]
					const block = data.slice(currentIndex, section.fromIndex)
					if(block.length) {
						await writeWithReveal(block, true)
					}

					const redacted = data.slice(section.fromIndex, section.toIndex)
					await writeWithReveal(redacted, false)
					currentIndex = section.toIndex
				}

				// write if redactions were there
				const lastBlockStart = redactedSections?.[redactedSections.length - 1]?.toIndex || 0
				const block = data.slice(lastBlockStart)
				if(block.length) {
					await writeWithReveal(block, true)
				}
			}

			async function writeRedactedZk() {
				await tls.write(data)
				const lastBlock = getLastBlock(
					TranscriptMessageSenderType
						.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
				)
				lastBlock!.reveal = {
					type: 'zk',
					redactedPlaintext: redactSlices(
						data,
						redactedSections
					)
				}
			}
		}
	}

	async function listenToDataFromServer(
		result: AsyncIterable<PullFromSessionResponse>,
		onReady: () => void
	) {
		try {
			for await (const { message, index } of result) {
				// empty record header means the session is ready
				if(!message?.recordHeader?.length) {
					onReady()
					continue
				}

				logger?.trace(
					{ length: message.content.length },
					'received packet'
				)

				const type = message.recordHeader[0]
				await tls.handleReceivedPacket(type, {
					header: message.recordHeader,
					content: message.content,
				})

				const block = getLastBlock(
					TranscriptMessageSenderType
						.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER
				)
				block!.index = index
			}
		} catch(error) {
			if(tls.hasEnded()) {
				logger.info('live stream ended after TLS close')
				return
			}

			if(!error.message.includes('aborted')) {
				await tls.end(error)
				throw error
			}
		}

		logger.info('live stream ended')
		await tls.end()
	}

	async function writeWithReveal(data: Uint8Array, reveal: boolean) {
		if(!reveal) {
			await tls.updateTrafficKeys()
		}

		await tls.write(data)
		// find the last packet sent by the client
		// and mark it for reveal
		const lastPkt = getLastBlock(TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT)
		if(reveal) {
			lastPkt!.reveal = { type: 'complete' }
		} else {
			delete lastPkt!.reveal
		}

		if(!reveal) {
			await tls.updateTrafficKeys()
		}
	}

	async function generatePSK() {
		const { Socket } = await import('net')
		const socket = new Socket()
		let onTicket: undefined | ((ticket: TLSSessionTicket) => void)
		const tls = makeTLSClient({
			host,
			logger,
			...additionalConnectOpts,
			async write({ header, content }) {
				socket.write(header)
				socket.write(content)
			},
			onSessionTicket(ticket) {
				onTicket?.(ticket)
			},
		})

		socket.once('connect', () => tls.startHandshake())
		socket.on('data', tls.handleReceivedBytes)

		socket.connect({ host, port })

		const ticket = new Promise<TLSSessionTicket>(resolve => {
			onTicket = resolve
		})

		logger.info('waiting for TLS ticket')

		psk = await tls.getPskFromTicket(await ticket)

		logger.info('got TLS ticket, ending session...')
		socket.end()
		tls.end()
	}

	function getLastBlock(sender: TranscriptMessageSenderType) {
		// set the correct index for the server blocks
		for(let i = allPackets.length - 1;i >= 0;i--) {
			const block = allPackets[i]
			if(block.sender === sender) {
				return block
			}
		}
	}

	function isApplicationData(packet: CompleteTLSPacket) {
		return packet.ctx.type === 'ciphertext'
			&& (
				packet.ctx.contentType === 'APPLICATION_DATA'
				|| (
					packet.packet.header[0] === PACKET_TYPE.WRAPPED_RECORD
					&& metadata.version === 'TLS1_2'
				)
			)
	}
}