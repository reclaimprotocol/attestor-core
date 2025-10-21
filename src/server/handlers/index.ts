import { claimTeeBundle } from '#src/server/handlers/claimTeeBundle.ts'
import { claimTunnel } from '#src/server/handlers/claimTunnel.ts'
import { completeClaimOnChain } from '#src/server/handlers/completeClaimOnChain.ts'
import { createClaimOnChain } from '#src/server/handlers/createClaimOnChain.ts'
import { createTaskOnMechain } from '#src/server/handlers/createTaskOnMechain.ts'
import { createTunnel } from '#src/server/handlers/createTunnel.ts'
import { disconnectTunnel } from '#src/server/handlers/disconnectTunnel.ts'
import { fetchCertificateBytes } from '#src/server/handlers/fetchCertificateBytes.ts'
import { init } from '#src/server/handlers/init.ts'
import { toprf } from '#src/server/handlers/toprf.ts'
import type { RPCHandler, RPCType } from '#src/types/index.ts'

export const HANDLERS: { [T in RPCType]: RPCHandler<T> } = {
	createTunnel,
	disconnectTunnel,
	claimTunnel,
	claimTeeBundle,
	init,
	createClaimOnChain,
	completeClaimOnChain,
	toprf,
	createTaskOnMechain,
	fetchCertificateBytes
}