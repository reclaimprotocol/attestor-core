import { base64 } from 'ethers/lib/utils'
import { DEFAULT_METADATA, DEFAULT_RPC_TIMEOUT_MS } from 'src/config'
import { InitResponse, RPCMessages } from 'src/proto/api'
import { IAttestorClient, IAttestorClientCreateOpts, RPCEvent, RPCRequestData, RPCResponseData, RPCType } from 'src/types'
import { AttestorError, generateRpcMessageId, getRpcRequestType, logger as LOGGER, packRpcMessages } from 'src/utils'
import { AttestorSocket } from 'src/utils/socket-base'
import { makeWebSocket as defaultMakeWebSocket } from 'src/utils/ws'

export class AttestorClient extends AttestorSocket implements IAttestorClient {

	private waitForInitPromise: Promise<void>

	public initResponse?: InitResponse

	constructor({
		url,
		initMessages = [],
		signatureType = DEFAULT_METADATA.signatureType,
		logger = LOGGER,
		authRequest,
		makeWebSocket = defaultMakeWebSocket
	}: IAttestorClientCreateOpts) {
		const initRequest = {
			...DEFAULT_METADATA,
			signatureType,
			auth: authRequest
		}
		const msg = packRpcMessages({ initRequest }, ...initMessages)
		const initRequestBytes = RPCMessages.encode(msg).finish()
		const initRequestB64 = base64.encode(initRequestBytes)

		url = new URL(url.toString())
		url.searchParams.set('messages', initRequestB64)

		super(
			makeWebSocket(url) as WebSocket,
			initRequest,
			logger
		)

		const initReqId = msg.messages[0].id
		this.waitForInitPromise = this
			.waitForResponse<'init'>(initReqId, DEFAULT_RPC_TIMEOUT_MS)
			.then(res => {
				logger.info('client initialised')
				this.isInitialised = true
				this.initResponse = res
			})
		// swallow the error if anything bad happens, and we've no
		// catch block to handle it
		this.waitForInitPromise
			.catch(() => { })

		this.addEventListener('connection-terminated', ev => (
			logger.info({ err: ev.data }, 'connection terminated')
		))
	}

	async rpc<T extends RPCType>(
		type: T,
		request: Partial<RPCRequestData<T>>,
		timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS
	) {

		const msgId = generateRpcMessageId()
		this.logger.debug({ type, id: msgId }, 'sending rpc request')
		const now = Date.now()
		try {
			const rslt = this.waitForResponse<T>(msgId, timeoutMs)
			await this.sendMessage({ id: msgId, [getRpcRequestType(type)]: request })

			return await rslt
		} finally {
			const timeTakenMs = Date.now() - now
			this.logger.debug({ type, timeTakenMs }, 'received rpc response')
		}
	}

	waitForResponse<T extends RPCType>(
		id: number,
		timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS
	) {
		if(this.isClosed) {
			throw new AttestorError(
				'ERROR_NETWORK_ERROR',
				'Client connection already closed'
			)
		}

		// setup a promise to wait for the response
		return new Promise<RPCResponseData<T>>((resolve, reject) => {
			const handler = (event: RPCEvent<'rpc-response'>) => {
				if(event.data.id !== id) {
					return
				}

				removeHandlers()
				if('error' in event.data) {
					reject(event.data.error)
					return
				}

				// @ts-expect-error
				resolve(event.data.data)
			}

			const terminateHandler = (event: RPCEvent<'connection-terminated'>) => {
				removeHandlers()
				// if the connection was terminated, reject the promise
				// but update the error code to reflect the network error
				if(event.data.code === 'ERROR_NO_ERROR') {
					reject(
						new AttestorError(
							'ERROR_NETWORK_ERROR',
							event.data.message,
							event.data.data
						)
					)
					return
				}

				reject(event.data)
			}

			const timeout = setTimeout(() => {
				removeHandlers()
				reject(
					new AttestorError(
						'ERROR_TIMEOUT',
						`RPC request timed out after ${timeoutMs}ms`,
						{ id }
					)
				)
			}, timeoutMs)

			const removeHandlers = () => {
				clearTimeout(timeout)
				this.removeEventListener('rpc-response', handler)
				this.removeEventListener('connection-terminated', terminateHandler)
			}

			this.addEventListener('rpc-response', handler)
			this.addEventListener('connection-terminated', terminateHandler)
		})
	}

	waitForInit = () => {
		if(this.isClosed) {
			throw new AttestorError(
				'ERROR_NETWORK_ERROR',
				'Client connection already closed'
			)
		}

		return this.waitForInitPromise
	}
}