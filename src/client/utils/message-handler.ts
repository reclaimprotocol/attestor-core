import { RPCMessage, RPCMessages } from 'src/proto/api'
import { IAttestorSocket } from 'src/types'
import { AttestorError, extractArrayBufferFromWsData, getRpcRequest, getRpcRequestType, getRpcResponseType } from 'src/utils'

export async function wsMessageHandler(this: IAttestorSocket, data: unknown) {
	// extract array buffer from WS data & decode proto
	const buff = await extractArrayBufferFromWsData(data)
	const { messages } = RPCMessages.decode(buff)
	for(const msg of messages) {
		await handleMessage.call(this, msg)
	}
}

export function handleMessage(this: IAttestorSocket, msg: RPCMessage) {
	// handle connection termination alert
	if(msg.connectionTerminationAlert) {
		const err = AttestorError.fromProto(
			msg.connectionTerminationAlert
		)
		this.logger?.warn(
			{
				err: err.code !== 'ERROR_NO_ERROR'
					? err
					: undefined
			},
			'received connection termination alert'
		)
		this.dispatchRPCEvent('connection-terminated', err)
		return
	}

	const rpcRequest = getRpcRequest(msg)
	if(rpcRequest) {
		if(
			rpcRequest.direction === 'response'
			&& rpcRequest.type === 'error'
		) {
			this.dispatchRPCEvent('rpc-response', {
				id: msg.id,
				error: AttestorError.fromProto(msg.requestError)
			})
			return
		}

		const resType = getRpcResponseType(rpcRequest.type)
		if(rpcRequest.direction === 'response') {
			this.dispatchRPCEvent('rpc-response', {
				id: msg.id,
				type: rpcRequest.type,
				data: msg[resType]!
			})
			return
		}

		if(!this.isInitialised && rpcRequest.type !== 'init') {
			this.logger.warn(
				{ type: rpcRequest.type },
				'RPC request received before initialisation'
			)
			void this.sendMessage({
				id: msg.id,
				requestError: AttestorError
					.badRequest('Initialise connection first')
					.toProto()
			})
			return
		}

		return new Promise<void>((resolve, reject) => {
			this.dispatchRPCEvent('rpc-request', {
				requestId: msg.id,
				type: rpcRequest.type,
				data: msg[getRpcRequestType(rpcRequest.type)]!,
				respond: (res) => {
					if(!this.isOpen) {
						this.logger?.debug(
							{ type: rpcRequest.type, res },
							'connection closed before responding'
						)
						reject(new Error('connection closed'))
						return
					}

					if('code' in res) {
						reject(res)
						return this.sendMessage({
							id: msg.id,
							requestError: res.toProto()
						})
					}

					resolve()
					return this
						.sendMessage({ id: msg.id, [resType]: res })
				},
			})
		})
	}

	if(msg.tunnelMessage) {
		this.dispatchRPCEvent('tunnel-message', msg.tunnelMessage)
		return
	}

	if(msg.tunnelDisconnectEvent) {
		this.dispatchRPCEvent(
			'tunnel-disconnect-event',
			msg.tunnelDisconnectEvent
		)
		return
	}

	this.logger.warn({ msg }, 'unhandled message')
}