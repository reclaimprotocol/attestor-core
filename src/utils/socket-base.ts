import type { WebSocket as WSWebSocket } from 'ws'

import { wsMessageHandler } from '#src/client/utils/message-handler.ts'
import type { InitRequest, RPCMessage } from '#src/proto/api.ts'
import { RPCMessages } from '#src/proto/api.ts'
import type { IAttestorSocket, Logger, RPCEvent, RPCEventMap } from '#src/types/index.ts'
import { AttestorError, makeRpcEvent, packRpcMessages } from '#src/utils/index.ts'

/**
 * Common AttestorSocket class used on the client & server side as the
 * base for their respective socket implementations.
 */
export class AttestorSocket implements IAttestorSocket {

	private eventTarget = new EventTarget()
	protected socket: WebSocket | WSWebSocket
	readonly logger: Logger
	readonly metadata: InitRequest

	isInitialised = false

	constructor(
		socket: WebSocket | WSWebSocket,
		metadata: InitRequest,
		logger: Logger
	) {
		this.socket = socket
		this.metadata = metadata
		this.logger = logger

		socket.addEventListener('error', (event) => {
			const witErr = AttestorError.fromError(
				event.error || new Error(event.message),
				'ERROR_NETWORK_ERROR'
			)

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

		this.logger.trace({ msg }, 'sending messages')

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