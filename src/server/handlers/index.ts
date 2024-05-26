import { RPCHandler, RPCType } from '../../types'
import { claimTunnel } from './claimTunnel'
import { createTunnel } from './createTunnel'
import { disconnectTunnel } from './disconnectTunnel'

export const HANDLERS: { [T in RPCType]: RPCHandler<T> } = {
	createTunnel,
	disconnectTunnel,
	claimTunnel
}