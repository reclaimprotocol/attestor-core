import { ReclaimRPCMessage } from '../../proto/api'
import { WitnessError } from '../../utils'
import { IWitnessSocket } from '../types'
import { extractArrayBufferFromWsData, getRpcRequest, getRpcRequestType, getRpcResponseType } from '../utils/generics'

export function messageHandler(this: IWitnessSocket, data: unknown) {
	// extract array buffer from WS data & decode proto
	const buff = extractArrayBufferFromWsData(data)
	const msg = ReclaimRPCMessage.decode(buff)
	// handle connection termination alert
	if(msg.connectionTerminationAlert) {
		const err = WitnessError.fromProto(
			msg.connectionTerminationAlert
		)
		this.logger?.warn(
			{ err },
			'received connection termination alert'
		)
		this.dispatchRPCEvent('connection-terminated', err)
		return
	}

	if(msg.initResponse) {
		this.isInitialised = true
		this.dispatchRPCEvent('init-response', {})
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
				error: WitnessError.fromProto(msg.requestError!)
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
					return
				}

				if('code' in res) {
					return this.sendMessage({
						id: msg.id,
						requestError: res.toProto()
					})
				}

				return this
					.sendMessage({ id: msg.id, [resType]: res })
			},
		})
		return
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

	throw new WitnessError(
		'WITNESS_ERROR_INTERNAL',
		'unknown message type',
		{ msg }
	)
}