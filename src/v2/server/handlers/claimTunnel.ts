import { RPCHandler } from "../../types";

export const claimTunnel: RPCHandler<'claimTunnel'> = async(
	{ },
	{ tx, logger, client }
) => {
	throw new Error('Not implemented')
}