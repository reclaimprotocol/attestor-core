import { makeSnarkJsZKOperator, ZKOperator } from '@reclaimprotocol/circom-chacha20'
import { crypto, generateIV, makeTLSClient, SUPPORTED_CIPHER_SUITE_MAP, TLSConnectionOptions, TLSEventMap, TLSPresharedKey } from '@reclaimprotocol/tls'
import { Logger } from 'pino'
import { FinaliseSessionRequest_Block, InitialiseSessionRequest, PullFromSessionResponse, PushToSessionRequest, ReclaimWitnessClient, TlsCipherSuiteType, WitnessVersion } from '../proto/api'
import { ArraySlice } from '../types'
import MAIN_LOGGER from '../utils/logger'
import { prepareZkProofs } from '../utils/zk'

export type APITLSClientOptions = {
	host: string
	port: number
	client: ReclaimWitnessClient
	/** return the sections of the response to redact */
	redactResponse?(data: Uint8Array): ArraySlice[]
	request?: Partial<InitialiseSessionRequest>
	logger?: Logger
	additionalConnectOpts?: TLSConnectionOptions
	zkOperator?: ZKOperator
}

// eslint-disable-next-line camelcase
type BlockToReveal = Partial<FinaliseSessionRequest_Block>

type ServerBlock = BlockToReveal & {
	plaintext: Uint8Array
	ciphertext: Uint8Array
}

const EMPTY_UINT8ARRAY = new Uint8Array(0)

// we only support chacha20-poly1305 for API sessions
// that need ZK proofs
const ZK_CIPHER_SUITES: (keyof typeof SUPPORTED_CIPHER_SUITE_MAP)[]
	= ['TLS_CHACHA20_POLY1305_SHA256']

// map the TLS cipher suites to the API cipher suites
const CIPHER_SUITE_MAP: { [K in keyof typeof SUPPORTED_CIPHER_SUITE_MAP]: TlsCipherSuiteType } = {
	'TLS_CHACHA20_POLY1305_SHA256': TlsCipherSuiteType.TLS_CIPHER_SUITE_TYPE_CHACHA20_POLY1305_SHA256,
	'TLS_AES_256_GCM_SHA384': TlsCipherSuiteType.TLS_CIPHER_SUITE_TYPE_AES_256_GCM_SHA384,
	'TLS_AES_128_GCM_SHA256': TlsCipherSuiteType.TLS_CIPHER_SUITE_TYPE_AES_128_GCM_SHA256,
}

export const makeAPITLSClient = ({
	host,
	port,
	client,
	redactResponse,
	request,
	logger: _logger,
	additionalConnectOpts,
	zkOperator
}: APITLSClientOptions) => {
	let sessionId: string | undefined
	let abort: AbortController | undefined

	let pendingReveal = false
	let psk: TLSPresharedKey | undefined

	const logger = _logger || MAIN_LOGGER?.child({ })
	const enableResponseRedaction = !!redactResponse
	const { generateOutOfBandSession } = additionalConnectOpts || {}

	const blocksToReveal: BlockToReveal[] = []
	const allServerBlocks: ServerBlock[] = []
	const cipherSuites = enableResponseRedaction ? ZK_CIPHER_SUITES : undefined

	if(!enableResponseRedaction) {
		logger.info('disabled ZK proofs')
	}

	const tls = makeTLSClient({
		host,
		logger,
		cipherSuites,
		...additionalConnectOpts || {},
		async write({ header, content, authTag }) {
			if(!sessionId) {
				throw new Error('Too early to write')
			}

			if(pendingReveal && authTag?.length) {
				const keys = tls.getKeys()!
				const key = await crypto.exportKey(keys.clientEncKey)
				const iv = generateIV(keys.clientIv, keys.recordSendCount - 1)

				blocksToReveal.push({
					authTag,
					directReveal: {
						key,
						iv
					}
				})
				pendingReveal = false
			}

			const req: PushToSessionRequest = {
				sessionId,
				messages: [
					{
						recordHeader: header,
						content,
						authenticationTag: authTag || EMPTY_UINT8ARRAY
					}
				]
			}
			await client.pushToSession(req)

			logger.debug(
				{ sessionId, length: content.length },
				'pushed data'
			)
		}
	})

	return {
		generatePSK,
		/**
		 * handle data received from the server
		 * @param clb handle data, return if the block should be revealed or not
		 */
		async handleDataFromServer(clb: (data: Uint8Array) => void) {
			tls.ev.on('data', handlePlaintext)

			return () => {
				tls.ev.off('data', handlePlaintext)
			}

			async function handlePlaintext(
				{
					plaintext,
					ciphertext,
					authTag
				}: TLSEventMap['data']
			) {
				const keys = tls.getKeys()!
				const key = await crypto.exportKey(keys.serverEncKey)
				const iv = generateIV(keys.serverIv, keys.recordRecvCount - 1)

				allServerBlocks.push({
					authTag,
					directReveal: { key, iv },
					plaintext,
					ciphertext,
				})
				clb(plaintext)
			}
		},
		async onTlsSessionEnd(clb: (error?: Error) => void) {
			tls.ev.once('end', ({ error }) => clb(error))
		},
		async connect() {
			if(!psk && generateOutOfBandSession) {
				await generatePSK()
			}

			let initialiseSessionParams = request
			if(
				!initialiseSessionParams?.beaconBasedProviderClaimRequest
				&& !initialiseSessionParams?.receiptGenerationRequest
			) {
				initialiseSessionParams = {
					receiptGenerationRequest: {
						host,
						port
					},
					beaconBasedProviderClaimRequest: undefined
				}
			}

			logger.trace('initialising...')

			const res = await client.initialiseSession(initialiseSessionParams)
			sessionId = res.sessionId
			abort = new AbortController()

			logger.debug({ sessionId }, 'initialised session')

			const pullResult = await client.pullFromSession(
				{
					sessionId,
					version: WitnessVersion.WITNESS_VERSION_1_0_0
				},
				{ signal: abort?.signal }
			)

			logger.debug('pulling from session')

			const evPromise = listenToDataFromServer(
				pullResult,
				() => {
					logger.debug('session ready')
					tls.startHandshake({ psk })
				}
			)

			await Promise.race([
				evPromise,
				new Promise(resolve => {
					tls.ev.on('handshake', resolve)
				})
			])

			if(!tls.isHandshakeDone()) {
				throw new Error('Handshake failed')
			}

			logger.debug({ meta: tls.getMetadata() }, 'handshake done')

			return () => {
				abort?.abort()
			}
		},
		async cancel() {
			if(!sessionId) {
				throw new Error('Nothing to cancel')
			}

			abort?.abort()
			await client.cancelSession({ sessionId })

			await tls.end()
		},
		async finish() {
			if(!sessionId) {
				throw new Error('Nothing to cancel')
			}

			if(redactResponse && enableResponseRedaction) {
				const zkBlocks = await prepareZkProofs(
					{
						blocks: allServerBlocks,
						operator: zkOperator || makeSnarkJsZKOperator(logger),
						redact: redactResponse,
						logger,
					}
				)

				// if all blocks should be revealed, reveal them all
				if(zkBlocks === 'all') {
					blocksToReveal.push(...allServerBlocks)
				} else {
					for(const { block } of zkBlocks) {
						blocksToReveal.push(block)
					}
				}
			} else {
				blocksToReveal.push(...allServerBlocks)
			}

			abort?.abort()

			const cipherSuite = tls.getMetadata().cipherSuite!
			const result = await client.finaliseSession({
				sessionId,
				revealBlocks: blocksToReveal,
				cipherSuite: CIPHER_SUITE_MAP[cipherSuite]
			})

			tls.end()

			return result
		},
		async write(data: Uint8Array, redactedSections: ArraySlice[]) {
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
	}


	async function listenToDataFromServer(
		result: AsyncIterable<PullFromSessionResponse>,
		onReady: () => void
	) {
		try {
			for await (const { message } of result) {
				// empty record header means the session is ready
				if(!message?.recordHeader?.length) {
					onReady()
					continue
				}

				const type = message.recordHeader[0]
				tls.handleReceivedPacket(type, {
					header: message.recordHeader,
					content: message.content,
					authTag: message.authenticationTag,
				})
			}
		} catch(error) {
			if(!error.message.includes('aborted')) {
				throw error
			}
		}
	}

	async function writeWithReveal(data: Uint8Array, reveal: boolean) {
		if(!reveal) {
			await tls.updateTrafficKeys()
		}

		if(reveal) {
			pendingReveal = true
		}

		await tls.write(data)

		if(!reveal) {
			await tls.updateTrafficKeys()
		}
	}

	async function generatePSK() {
		const { Socket } = await import('net')
		const socket = new Socket()
		const tls = makeTLSClient({
			host,
			logger,
			cipherSuites,
			...additionalConnectOpts || {},
			async write({ header, content, authTag }) {
				socket.write(header)
				socket.write(content)
				if(authTag) {
					socket.write(authTag)
				}
			}
		})

		socket.once('connect', () => tls.startHandshake())
		socket.on('data', tls.handleReceivedBytes)

		socket.connect({ host, port })

		const newPsk = new Promise<TLSPresharedKey>(resolve => {
			tls.ev.once('session-ticket', ticket => {
				resolve(tls.getPskFromTicket(ticket))
			})
		})

		await new Promise((resolve, reject) => {
			socket.once('error', reject)
			tls.ev.once('handshake', resolve)
		})

		logger.info('waiting for TLS ticket')

		psk = await newPsk

		logger.info('got TLS ticket, ending session...')
		socket.end()
		tls.end()
	}
}