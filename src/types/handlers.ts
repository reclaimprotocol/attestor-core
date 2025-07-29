import type { Transaction } from 'elastic-apm-node'
import type { IAttestorServerSocket } from 'src/types/client.ts'
import type { Logger } from 'src/types/general.ts'
import type { RPCRequestData, RPCResponseData, RPCType } from 'src/types/rpc.ts'

export type RPCHandlerMetadata = {
	logger: Logger
	tx?: Transaction
	client: IAttestorServerSocket
}

export type RPCHandler<R extends RPCType> = (
	data: RPCRequestData<R>,
	ctx: RPCHandlerMetadata
) => Promise<RPCResponseData<R>>