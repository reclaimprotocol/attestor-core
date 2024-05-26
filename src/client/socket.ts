import { InitRequest, ReclaimRPCMessage } from '../proto/api'
import { IWitnessSocket, Logger, RPCEvent, RPCEventMap } from '../types'
import { generateRpcMessageId, makeRpcEvent, WitnessError } from '../utils'
import { messageHandler } from './message-handler'

export class WitnessSocket implements IWitnessSocket {

	private eventTarget = new EventTarget()

	isInitialised = false

	constructor(
		protected socket: WebSocket,
		public metadata: InitRequest,
		public logger: Logger
	) {
		socket.binaryType = 'arraybuffer'
		socket.addEventListener('error', (event: ErrorEvent) => {
			const witErr = WitnessError.fromError(
				event.error
					|| new Error(event.message)
			)
			this.dispatchRPCEvent('connection-terminated', witErr)
		})

		socket.addEventListener('close', () => (
			this.dispatchRPCEvent(
				'connection-terminated',
				new WitnessError(
					'WITNESS_ERROR_NO_ERROR',
					'connection closed'
				)
			)
		))

		socket.addEventListener('message', ({ data }) => {
			try {
				messageHandler.call(this, data)
			} catch(err) {
				this.logger?.error({ err }, 'error processing message')
				this.terminateConnection(err)
			}
		})
	}

	get isOpen() {
		return this.socket.readyState === WebSocket.OPEN
	}

	async sendMessage(msg: Partial<ReclaimRPCMessage>) {
		if(!this.isOpen) {
			throw new Error('socket is not open')
		}

		msg.id ||= generateRpcMessageId()
		const bytes = ReclaimRPCMessage
			.encode(ReclaimRPCMessage.create(msg))
			.finish()
		await this.socket.send(bytes)
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
		if(this.socket.readyState === WebSocket.CLOSED) {
			return
		}

		try {
			const witErr = err
				? WitnessError.fromError(err)
				: new WitnessError('WITNESS_ERROR_NO_ERROR', '')
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