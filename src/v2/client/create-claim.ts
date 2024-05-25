import { strToUint8Array, TLSPacketContext } from '@reclaimprotocol/tls'
import canonicalize from 'canonicalize'
import { DEFAULT_HTTPS_PORT } from '../../config'
import { ClaimTunnelRequest } from '../../proto/api'
import { ProviderName, providers } from '../../providers'
import { MessageRevealInfo } from '../../types'
import { getBlocksToReveal, getProviderValue, makeHttpResponseParser, redactSlices, unixTimestampSeconds } from '../../utils'
import { preparePacketsForReveal } from '../../utils/prepare-packets'
import { makeRpcTlsTunnel } from '../tunnels/make-rpc-tls-tunnel'
import { CreateClaimOpts, IWitnessClient } from '../types'
import { generateTunnelId, isApplicationData } from '../utils/generics'

type ServerAppDataPacket = {
	plaintext: Uint8Array
	message: TLSPacketContext
}

export async function createClaim<N extends ProviderName>(
	this: IWitnessClient,
	{
		name,
		params,
		secretParams,
		context,
		onStep,
		...zkOpts
	}: CreateClaimOpts<N>
) {
	const logger = this.logger
	const provider = providers[name]

	const hostPort = getProviderValue(params, provider.hostPort)
	const geoLocation = getProviderValue(params, provider.geoLocation)
	const redactionMode = getProviderValue(params, provider.writeRedactionMode)
	const [host, port] = hostPort.split(':')
	const resParser = makeHttpResponseParser()
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
		client: this,
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
		if(redactionMode === 'key-update') {
			await writeRedactedWithKeyUpdate()
		} else {
			await writeRedactedZk()
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

	// now that we have the full transcript, we need
	// to generate the ZK proofs & send them to the witness
	// to verify & sign our claim
	const claimTunnelReq = ClaimTunnelRequest.create({
		request: createTunnelReq,
		timestampS: unixTimestampSeconds(),
		info: {
			provider: name,
			parameters: canonicalize(params)!,
			context: canonicalize(context)!,
		},
		transcript: await generateTranscript()
	})

	onStep?.({ name: 'waiting-for-verification' })

	const claimTunnelBytes = ClaimTunnelRequest
		.encode(claimTunnelReq).finish()
	const requestSignature = await this.sign(claimTunnelBytes)
	claimTunnelReq.signatures = { requestSignature }

	const result = await this.rpc('claimTunnel', claimTunnelReq)

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

	async function writeWithReveal(data: Uint8Array, reveal: boolean) {
		if(!reveal) {
			await tunnel.tls.updateTrafficKeys()
		}

		await tunnel.write(data)
		// find the last packet sent by the client
		// and mark it for reveal
		setRevealOfLastSentBlock(reveal ? { type: 'complete' } : undefined)

		if(!reveal) {
			await tunnel.tls.updateTrafficKeys()
		}
	}

	function setRevealOfLastSentBlock(reveal: MessageRevealInfo | undefined) {
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
}