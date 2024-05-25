import { Transaction } from 'elastic-apm-node'
import { Logger } from '../../types'
import { IWitnessServerSocket } from './client'
import { RPCRequestData, RPCResponseData, RPCType } from './rpc'

export type RPCHandlerMetadata = {
	logger: Logger
	tx?: Transaction
	client: IWitnessServerSocket
}

export type RPCHandler<R extends RPCType> = (
	data: RPCRequestData<R>,
	ctx: RPCHandlerMetadata
) => Promise<RPCResponseData<R>>