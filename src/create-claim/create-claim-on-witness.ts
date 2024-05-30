import { strToUint8Array, TLSPacketContext } from '@reclaimprotocol/tls'
import { DEFAULT_HTTPS_PORT } from '../config'
import { ClaimTunnelRequest } from '../proto/api'
import { ProviderName, providers } from '../providers'
import { SIGNATURES } from '../signatures'
import { makeRpcTlsTunnel } from '../tunnels/make-rpc-tls-tunnel'
import { CreateClaimOnWitnessOpts, IWitnessClient, MessageRevealInfo } from '../types'
import { canonicalStringify, generateTunnelId, getBlocksToReveal, getProviderValue, isApplicationData, logger as LOGGER, makeHttpResponseParser, preparePacketsForReveal, redactSlices, unixTimestampSeconds } from '../utils'
import { getWitnessClientFromPool } from './witness-pool'

type ServerAppDataPacket = {
	plaintext: Uint8Array
	message: TLSPacketContext
}

/**
 * Create a claim on a witness server
 */
export async function createClaimOnWitness<N extends ProviderName>(
	{
		name,
		params,
		secretParams,
		context,
		onStep,
		ownerPrivateKey,
		client: clientInit,
		logger: _logger,
		...zkOpts
	}: CreateClaimOnWitnessOpts<N>
) {
	const provider = providers[name]
	const logger = _logger
		|| ('logger' in clientInit ? clientInit.logger : LOGGER)

	const hostPort = getProviderValue(params, provider.hostPort)
	const geoLocation = getProviderValue(params, provider.geoLocation)
	let redactionMode = getProviderValue(params, provider.writeRedactionMode)
	const [host, port] = hostPort.split(':')
	const resParser = makeHttpResponseParser()
	let client: IWitnessClient
	let lastMsgRevealed = false

	const revealMap = new Map<TLSPacketContext, MessageRevealInfo>()

	const additionalClientOptions = {
		...provider.additionalClientOptions || {}
	}

	if(provider.additionalClientOptions?.rootCAs) {
		additionalClientOptions.rootCAs = [
			...(additionalClientOptions.rootCAs || [ ]),
			...provider.additionalClientOptions.rootCAs,
		]
	}

	onStep?.({ name: 'connecting' })

	let endedHttpRequest: ((err?: Error) => void) | undefined
	const createTunnelReq = {
		host,
		port: port ? +port : DEFAULT_HTTPS_PORT,
		geoLocation,
		id: generateTunnelId()
	}

	const tunnel = await makeRpcTlsTunnel({
		tlsOpts: provider.additionalClientOptions || {},
		connect: (initMessages) => {
			if('metadata' in clientInit) {
				client = clientInit
				client
					.waitForInit()
					.then(() => client.sendMessage(...initMessages))
			} else {
				client = getWitnessClientFromPool(
					clientInit.url,
					{ initMessages, logger }
				)
			}

			return client
		},
		logger,
		request: createTunnelReq,
		onMessage(data) {
			resParser.onChunk(data)
			if(resParser.res.complete) {
				logger?.debug('got complete HTTP response from server')
				// wait a little bit to make sure the client has
				// finished writing the response
				setTimeout(() => {
					endedHttpRequest?.()
				}, 100)
			}
		},
		onClose(err) {
			const level = err ? 'error' : 'debug'
			logger?.[level]({ err }, 'tls session ended')
			endedHttpRequest?.(err)
			try {
				resParser.streamEnded()
			} catch{ }
		},
	})
	const {
		version: tlsVersion,
		cipherSuite
	} = tunnel.tls.getMetadata()
	if(tlsVersion === 'TLS1_2' && redactionMode !== 'zk') {
		redactionMode = 'zk'
		logger.info('TLS1.2 detected, defaulting to zk redaction mode')
	}

	const {
		redactions,
		data: requestStr
	} = provider.createRequest(
		// @ts-ignore
		secretParams,
		params
	)
	const requestData = typeof requestStr === 'string'
		? strToUint8Array(requestStr)
		: requestStr

	logger.debug(
		{ redactions: redactions.length },
		'generated request'
	)

	const waitForAllData = new Promise<void>(
		(resolve, reject) => {
			endedHttpRequest = err => (
				err ? reject(err) : resolve()
			)
		}
	)

	onStep?.({ name: 'sending-request-data' })

	try {
		if(redactionMode === 'zk') {
			await writeRedactedZk()
		} else {
			await writeRedactedWithKeyUpdate()
		}

		logger.info('wrote request to server')
	} catch(err) {
		// wait for complete stream end when the session is closed
		// mid-write, as this means the server could not process
		// our request due to some error. Hope the stream end
		// error will be more descriptive
		logger.error(
			{ err },
			'session errored during write, waiting for stream end'
		)
	}

	onStep?.({ name: 'waiting-for-response' })

	await waitForAllData
	await tunnel.close()

	logger.info('got full response from server')

	const signatureAlg = SIGNATURES[client!.metadata.signatureType]

	// now that we have the full transcript, we need
	// to generate the ZK proofs & send them to the witness
	// to verify & sign our claim
	const claimTunnelReq = ClaimTunnelRequest.create({
		request: createTunnelReq,
		data: {
			provider: name,
			parameters: canonicalStringify(params),
			context: canonicalStringify(context),
			timestampS: unixTimestampSeconds(),
			owner: getAddress(),
		},
		transcript: await generateTranscript()
	})

	onStep?.({ name: 'waiting-for-verification' })

	const claimTunnelBytes = ClaimTunnelRequest
		.encode(claimTunnelReq).finish()
	const requestSignature = await signatureAlg
		.sign(claimTunnelBytes, ownerPrivateKey)
	claimTunnelReq.signatures = { requestSignature }

	const result = await client!.rpc('claimTunnel', claimTunnelReq)
	return result

	async function writeRedactedWithKeyUpdate() {
		let currentIndex = 0
		for(let i = 0;i < redactions.length;i++) {
			const section = redactions[i]
			const block = requestData
				.slice(currentIndex, section.fromIndex)
			if(block.length) {
				await writeWithReveal(block, true)
			}

			const redacted = requestData
				.slice(section.fromIndex, section.toIndex)
			await writeWithReveal(redacted, false)
			currentIndex = section.toIndex
		}

		// write if redactions were there
		const lastBlockStart = redactions?.[redactions.length - 1]
			?.toIndex || 0
		const block = requestData.slice(lastBlockStart)
		if(block.length) {
			await writeWithReveal(block, true)
		}
	}

	async function writeRedactedZk() {
		await tunnel.tls.write(requestData)
		setRevealOfLastSentBlock(
			{
				type: 'zk',
				redactedPlaintext: redactSlices(requestData, redactions)
			}
		)
	}

	/**
	 * Write data to the tunnel, with the option to mark the packet
	 * as revealable to the witness or not
	 */
	async function writeWithReveal(data: Uint8Array, reveal: boolean) {
		// if the reveal state has changed, update the traffic keys
		// to not accidentally reveal a packet not meant to be revealed
		// and vice versa
		if(reveal !== lastMsgRevealed) {
			await tunnel.tls.updateTrafficKeys()
		}

		await tunnel.write(data)
		// now we mark the packet to be revealed to the witness
		setRevealOfLastSentBlock(reveal ? { type: 'complete' } : undefined)
		lastMsgRevealed = reveal
	}

	function setRevealOfLastSentBlock(
		reveal: MessageRevealInfo | undefined
	) {
		const lastBlock = getLastBlock('client')
		if(!lastBlock) {
			return
		}

		setRevealOfMessage(lastBlock.message, reveal)
	}

	function getLastBlock(sender: 'client' | 'server') {
		// set the correct index for the server blocks
		for(let i = tunnel.transcript.length - 1;i >= 0;i--) {
			const block = tunnel.transcript[i]
			if(block.sender === sender) {
				return block
			}
		}
	}

	/**
	 * Generate transcript with reveal data for the witness to verify
	 */
	async function generateTranscript() {
		addServerSideReveals()

		const startMs = Date.now()
		const revealedMessages = await preparePacketsForReveal(
			tunnel.transcript,
			revealMap,
			{
				logger,
				cipherSuite: cipherSuite!,
				onZkProgress(done, total) {
					const timeSinceStartMs = Date.now() - startMs
					const timePerBlockMs = timeSinceStartMs / done
					const timeLeftMs = timePerBlockMs * (total - done)
					onStep?.({
						name: 'generating-zk-proofs',
						proofsDone: done,
						proofsTotal: total,
						approxTimeLeftS: Math.round(timeLeftMs / 1000),
					})
				},
				...zkOpts,
			}
		)

		return revealedMessages
	}

	/**
	 * Add reveals for server side blocks, using
	 * the provider's redaction function if available.
	 * Otherwise, opts to reveal all server side blocks.
	 */
	function addServerSideReveals() {
		const allPackets = tunnel.transcript
		let serverPacketsToReveal: ReturnType<typeof getBlocksToReveal<ServerAppDataPacket>> = 'all'
		if(provider.getResponseRedactions) {
			const serverBlocks: ServerAppDataPacket[] = []
			for(let i = 0;i < allPackets.length;i++) {
				const b = allPackets[i]
				if(
					b.sender !== 'server'
					|| b.message.type !== 'ciphertext'
					|| !isApplicationData(b.message, tlsVersion!)
				) {
					continue
				}

				serverBlocks.push({
					plaintext: tlsVersion === 'TLS1_3'
						? b.message.plaintext.slice(0, -1)
						: b.message.plaintext,
					message: b.message
				})
			}

			serverPacketsToReveal = getBlocksToReveal(
				serverBlocks,
				total => provider.getResponseRedactions!(
					total,
					params
				)
			)
		}

		if(serverPacketsToReveal === 'all') {
			// reveal all server side blocks
			for(const { message, sender } of allPackets) {
				if(sender === 'server') {
					setRevealOfMessage(message, { type: 'complete' })
				}
			}
		} else {
			for(const { block, redactedPlaintext } of serverPacketsToReveal) {
				setRevealOfMessage(block.message, {
					type: 'zk',
					redactedPlaintext
				})
			}
		}

		// reveal all client side handshake blocks
		// so the witness can verify there was no
		// hanky-panky
		for(const p of allPackets) {
			if(p.sender !== 'client') {
				continue
			}

			if(p.message.type !== 'ciphertext') {
				continue
			}

			// break the moment we hit the first
			// application data packet
			if(isApplicationData(p.message, tlsVersion!)) {
				break
			}

			if(redactionMode === 'zk') {
				setRevealOfMessage(p.message, {
					type: 'zk',
					redactedPlaintext: p.message.plaintext
				})
			} else {
				setRevealOfMessage(p.message, { type: 'complete' })
			}
		}
	}

	function setRevealOfMessage(message: TLSPacketContext, reveal: MessageRevealInfo | undefined) {
		if(reveal) {
			revealMap.set(message, reveal)
			return
		}

		revealMap.delete(message)
	}

	function getAddress() {
		const {
			getAddress,
			getPublicKey,
		} = signatureAlg
		const pubKey = getPublicKey(ownerPrivateKey)
		return getAddress(pubKey)
	}
}