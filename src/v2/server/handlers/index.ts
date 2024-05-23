import { RPCHandler, RPCRequestType } from '../../types'
import { createTunnel } from './createTunnel'
import { disconnectTunnel } from './disconnectTunnel'

export const HANDLERS: { [T in RPCRequestType]?: RPCHandler<T> } = {
	createTunnelRequest: createTunnel,
	disconnectTunnelRequest: disconnectTunnel
}