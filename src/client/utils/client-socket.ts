import { base64 } from 'ethers/lib/utils'
import { DEFAULT_METADATA } from 'src/config'
import { RPCMessages } from 'src/proto/api'
import { IWitnessClient, IWitnessClientCreateOpts, RPCEvent, RPCRequestData, RPCResponseData, RPCType } from 'src/types'
import { getRpcRequestType, logger as LOGGER, packRpcMessages, WitnessError } from 'src/utils'
import { WitnessSocket } from 'src/utils/socket-base'
import { Websocket as DefaultWebsocket } from 'src/utils/ws'

export class WitnessClient extends WitnessSocket implements IWitnessClient {

	private waitForInitPromise: Promise<void>

	constructor({
		url,
		initMessages = [],
		signatureType = DEFAULT_METADATA.signatureType,
		logger = LOGGER,
		Websocket = DefaultWebsocket
	}: IWitnessClientCreateOpts) {
		const initRequest = { ...DEFAULT_METADATA, signatureType }
		const msg = packRpcMessages({ initRequest }, ...initMessages)
		const initRequestBytes = RPCMessages.encode(msg).finish()
		const initRequestB64 = base64.encode(initRequestBytes)

		url = new URL(url.toString())
		url.searchParams.set('messages', initRequestB64)

		super(
			new Websocket(url) as WebSocket,
			initRequest,
			logger
		)

		const initReqId = msg.messages[0].id
		this.waitForInitPromise = this
			.waitForResponse<'init'>(initReqId)
			.then(() => {
				logger.info('client initialised')
				this.isInitialised = true
			})

		this.addEventListener('connection-terminated', ev => (
			logger.info({ err: ev.data }, 'connection terminated')
		))
	}

	async rpc<T extends RPCType>(
		type: T,
		request: Partial<RPCRequestData<T>>
	) {
		const {
			messages: [{ id }]
		} = await this.sendMessage({ [getRpcRequestType(type)]: request })
		const rslt = await this.waitForResponse<T>(id)
		return rslt
	}

	waitForResponse<T extends RPCType>(id: number) {
		if(this.isClosed) {
			throw new WitnessError(
				'WITNESS_ERROR_NETWORK_ERROR',
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
				if(event.data.code === 'WITNESS_ERROR_NO_ERROR') {
					reject(
						new WitnessError(
							'WITNESS_ERROR_NETWORK_ERROR',
							event.data.message,
							event.data.data
						)
					)
					return
				}

				reject(event.data)
			}

			const removeHandlers = () => {
				this.removeEventListener('rpc-response', handler)
				this.removeEventListener('connection-terminated', terminateHandler)
			}

			this.addEventListener('rpc-response', handler)
			this.addEventListener('connection-terminated', terminateHandler)
		})
	}

	waitForInit = () => {
		if(this.isClosed) {
			throw new WitnessError(
				'WITNESS_ERROR_NETWORK_ERROR',
				'Client connection already closed'
			)
		}

		return this.waitForInitPromise
	}
}