import type { Transaction } from 'elastic-apm-node'
import type { IAttestorServerSocket } from 'src/types/client'
import type { Logger } from 'src/types/general'
import type { RPCRequestData, RPCResponseData, RPCType } from 'src/types/rpc'

export type RPCHandlerMetadata = {
	logger: Logger
	tx?: Transaction
	client: IAttestorServerSocket
}

export type RPCHandler<R extends RPCType> = (
	data: RPCRequestData<R>,
	ctx: RPCHandlerMetadata
) => Promise<RPCResponseData<R>>