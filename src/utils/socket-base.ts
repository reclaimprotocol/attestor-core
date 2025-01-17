import { wsMessageHandler } from 'src/client/utils/message-handler'
import { InitRequest, RPCMessage, RPCMessages } from 'src/proto/api'
import { IAttestorSocket, Logger, RPCEvent, RPCEventMap } from 'src/types'
import { AttestorError, makeRpcEvent, packRpcMessages } from 'src/utils'
import type { WebSocket as WSWebSocket } from 'ws'

/**
 * Common AttestorSocket class used on the client & server side as the
 * base for their respective socket implementations.
 */
export class AttestorSocket implements IAttestorSocket {

	private eventTarget = new EventTarget()

	isInitialised = false

	constructor(
		protected socket: WebSocket | WSWebSocket,
		public metadata: InitRequest,
		public logger: Logger
	) {
		socket.addEventListener('error', (event) => {
			const witErr = AttestorError.fromError(
				event.error
					|| new Error(event.message)
			)
			witErr.code = 'ERROR_NETWORK_ERROR'

			this.dispatchRPCEvent('connection-terminated', witErr)
		})

		socket.addEventListener('close', () => (
			this.dispatchRPCEvent(
				'connection-terminated',
				new AttestorError(
					'ERROR_NO_ERROR',
					'connection closed'
				)
			)
		))

		socket.addEventListener('message', async({ data }) => {
			try {
				await wsMessageHandler.call(this, data)
			} catch(err) {
				this.logger.error({ err }, 'error processing message')
			}
		})
	}

	get isOpen() {
		return this.socket.readyState === this.socket.OPEN
	}

	get isClosed() {
		return this.socket.readyState === this.socket.CLOSED
			|| this.socket.readyState === this.socket.CLOSING
	}

	async sendMessage(...msgs: Partial<RPCMessage>[]) {
		if(this.isClosed) {
			throw new AttestorError(
				'ERROR_NETWORK_ERROR',
				'Connection closed, cannot send message'
			)
		}

		if(!this.isOpen) {
			throw new AttestorError(
				'ERROR_NETWORK_ERROR',
				'Wait for connection to open before sending message'
			)
		}

		const msg = packRpcMessages(...msgs)
		const bytes = RPCMessages.encode(msg).finish()

		if('sendPromise' in this.socket && this.socket.sendPromise) {
			await this.socket.sendPromise(bytes)
		} else {
			this.socket.send(bytes)
		}

		return msg
	}

	dispatchRPCEvent<K extends keyof RPCEventMap>(type: K, data: RPCEventMap[K]) {
		const event = makeRpcEvent(type, data)
		this.eventTarget.dispatchEvent(event)
	}

	addEventListener<K extends keyof RPCEventMap>(type: K, listener: (data: RPCEvent<K>) => void): void {
		this.eventTarget.addEventListener(type, listener)
	}

	removeEventListener<K extends keyof RPCEventMap>(type: K, listener: (data: RPCEvent<K>) => void): void {
		this.eventTarget.removeEventListener(type, listener)
	}

	async terminateConnection(err?: Error) {
		// connection already closed
		if(this.isClosed) {
			return
		}

		try {
			const witErr = err
				? AttestorError.fromError(err)
				: new AttestorError('ERROR_NO_ERROR', '')
			this.dispatchRPCEvent('connection-terminated', witErr)
			if(this.isOpen) {
				await this.sendMessage({
					connectionTerminationAlert: witErr.toProto()
				})
			}
		} catch(err) {
			this.logger?.error({ err }, 'error terminating connection')
		} finally {
			this.socket.close()
		}
	}
}