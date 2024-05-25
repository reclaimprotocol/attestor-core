import { base64 } from 'ethers/lib/utils'
import { InitRequest, ServiceSignatureType, WitnessVersion } from '../../proto/api'
import { ProviderName } from '../../providers'
import { SIGNATURES } from '../../signatures'
import { logger as LOGGER } from '../../utils'
import { CreateClaimOpts, IWitnessClient, RPCEvent, RPCRequestData, RPCResponseData, RPCType, WitnessClientOpts } from '../types'
import { generateRpcMessageId, getRpcRequestType } from '../utils/generics'
import { createClaim } from './create-claim'
import { WitnessSocket } from './socket'

const VERSION = WitnessVersion.WITNESS_VERSION_2_0_0

export class WitnessClient extends WitnessSocket implements IWitnessClient {

	private privateKeyHex: string

	constructor({
		privateKeyHex,
		url,
		signatureType = ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH,
		logger = LOGGER
	}: WitnessClientOpts) {
		const {
			getAddress,
			getPublicKey,
		} = SIGNATURES[signatureType]
		const pubKey = getPublicKey(privateKeyHex)
		const address = getAddress(pubKey)

		const initRequest: InitRequest = {
			userId: address,
			signatureType,
			clientVersion: VERSION
		}
		const initRequestBytes = InitRequest.encode(initRequest).finish()
		const initRequestB64 = base64.encode(initRequestBytes)

		url = new URL(url.toString())
		url.searchParams.set('initRequest', initRequestB64)

		const ws = new WebSocket(url.toString())

		super(ws, initRequest, logger)
		this.privateKeyHex = privateKeyHex
	}

	async sign(data: Uint8Array) {
		const sig = await SIGNATURES[this.metadata.signatureType]
			.sign(data, this.privateKeyHex)
		return sig
	}

	async rpc<T extends RPCType>(
		type: T,
		request: Partial<RPCRequestData<T>>
	) {
		const id = generateRpcMessageId()
		// setup a promise to wait for the response
		const promise = new Promise<RPCResponseData<typeof type>>((resolve, reject) => {
			const handler = (event: RPCEvent<'rpc-response'>) => {
				if(event.data.id !== id) {
					return
				}

				this.removeEventListener('rpc-response', handler)
				if('error' in event.data) {
					reject(event.data.error)
					return
				}

				// check if the response type matches the request type
				// if not, reject the promise
				if(event.data.type !== type) {
					reject(
						new Error(
							'unexpected response type: '
								+ event.data.type
						)
					)
					return
				}

				resolve(event.data.data as RPCResponseData<typeof type>)
			}

			this.addEventListener('rpc-response', handler)
		})

		await this.sendMessage({ id, [getRpcRequestType(type)]: request })

		const rslt = await promise
		return rslt
	}

	async waitForInit() {
		if(this.isInitialised) {
			return
		}

		// if neither open nor connecting, throw an error
		// as we'll never receive the init response
		if(!this.isOpen && this.socket.readyState !== WebSocket.CONNECTING) {
			throw new Error('socket is closed')
		}

		await new Promise<void>((resolve, reject) => {
			const handler = () => {
				removeHandlers()
				resolve()
			}

			const rejectHandler = (event: RPCEvent<'connection-terminated'>) => {
				removeHandlers()
				reject(event.data)
			}

			const removeHandlers = () => {
				this.removeEventListener('init-response', handler)
				this.removeEventListener('connection-terminated', rejectHandler)
			}

			this.addEventListener('init-response', handler)
			this.addEventListener('connection-terminated', rejectHandler)
		})
	}

	createClaim<N extends ProviderName>(opts: CreateClaimOpts<N>) {
		return createClaim.call(this, opts) as ReturnType<typeof createClaim<N>>
	}
}