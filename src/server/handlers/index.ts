import { claimTunnel } from 'src/server/handlers/claimTunnel'
import { completeClaimOnChain } from 'src/server/handlers/completeClaimOnChain'
import { createClaimOnChain } from 'src/server/handlers/createClaimOnChain'
import { createTaskOnMechain } from 'src/server/handlers/createTaskOnMechain'
import { createTunnel } from 'src/server/handlers/createTunnel'
import { disconnectTunnel } from 'src/server/handlers/disconnectTunnel'
import { init } from 'src/server/handlers/init'
import { toprf } from 'src/server/handlers/toprf'
import { RPCHandler, RPCType } from 'src/types'

export const HANDLERS: { [T in RPCType]: RPCHandler<T> } = {
	createTunnel,
	disconnectTunnel,
	claimTunnel,
	init,
	createClaimOnChain,
	completeClaimOnChain,
	toprf,
	createTaskOnMechain,
}