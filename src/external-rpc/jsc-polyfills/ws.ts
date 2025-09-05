import type { ExternalRPCIncomingMsg } from '#src/external-rpc/types.ts'
import { RPC_MSG_BRIDGE, rpcRequest } from '#src/external-rpc/utils.ts'

export class RPCWebSocket extends EventTarget implements WebSocket {

	readonly CONNECTING: 0 = 0
	readonly OPEN: 1 = 1
	readonly CLOSING: 2 = 2
	readonly CLOSED: 3 = 3

	readonly id = `ws_${Date.now()}`
	readonly binaryType: BinaryType = 'arraybuffer'
	readonly bufferedAmount: number = 0
	readonly extensions: string = ''
	readonly url: string
	readonly protocol: string
	readyState: number = this.CONNECTING

	onopen: ((this: WebSocket, ev: Event) => any) | null
	onerror: ((this: WebSocket, ev: Event) => any) | null
	onclose: ((this: WebSocket, ev: CloseEvent) => any) | null
	onmessage: ((this: WebSocket, ev: MessageEvent<any>) => any) | null

	#cancelRpcBridge?: (() => void)

	constructor(url: string) {
		super()
		this.url = url
		this.protocol = ''
		this.#onMessage = this.#onMessage.bind(this)

		rpcRequest({
			type: 'connectWs',
			request: { id: this.id,	url }
		})
			.then(() => this.#callOpen(new Event('open')))
			.catch(error => this.#callError(new ErrorEvent('error', { error })))
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if(
			typeof data !== 'string'
			&& !ArrayBuffer.isView(data)
		) {
			throw new TypeError('Data must be a string, Uint8Array or ArrayBuffer')
		}

		rpcRequest({ type: 'sendWsMessage', request: { id: this.id, data: data } })
	}

	close(code?: number, reason?: string): void {
		this.readyState = this.CLOSING
		rpcRequest({
			type: 'disconnectWs',
			request: { id: this.id, code, reason }
		})
			.then(() => this.#callClose(new CloseEvent('close', { code, reason })))
			.catch(error => this.#callError(new ErrorEvent('error', { error })))
	}

	#callOpen(ev: Event): void {
		this.readyState = this.OPEN
		this.onopen?.call(this, ev)
		this.dispatchEvent(ev)

		this.#cancelRpcBridge?.()
		this.#cancelRpcBridge = RPC_MSG_BRIDGE.addListener(this.#onMessage)
	}

	#callError(ev: ErrorEvent): void {
		this.readyState = this.CLOSED
		this.onerror?.call(this, ev)
		this.dispatchEvent(ev)
	}

	#callClose(ev: CloseEvent): void {
		this.readyState = this.CLOSED
		this.onclose?.call(this, ev)
		this.dispatchEvent(ev)
	}

	#onMessage = (msg: ExternalRPCIncomingMsg) => {
		if(msg.type === 'sendWsMessage' && msg.request.id === this.id) {
			const data = msg.request.data
			const event = new MessageEvent('message', { data })
			this.onmessage?.call(this, event)
			this.dispatchEvent(event)
			return
		}

		if(msg.type === 'disconnectWs' && msg.request.id === this.id) {
			if(!msg.request.err) {
				this.#callClose(
					new CloseEvent('close', { code: 1000, reason: 'Normal Closure' })
				)
				return
			}

			this.#callError(
				new ErrorEvent('error', { error: new Error(msg.request.err) })
			)
			return
		}
	}
}