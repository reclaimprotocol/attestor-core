import { RPCHandler, RPCType } from '../../types'
import { claimTunnel } from './claimTunnel'
import { completeClaimOnChain } from './completeClaimOnChain'
import { createClaimOnChain } from './createClaimOnChain'
import { createTunnel } from './createTunnel'
import { disconnectTunnel } from './disconnectTunnel'
import { init } from './init'

export const HANDLERS: { [T in RPCType]: RPCHandler<T> } = {
	createTunnel,
	disconnectTunnel,
	claimTunnel,
	init,
	createClaimOnChain,
	completeClaimOnChain
}