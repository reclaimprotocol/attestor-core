import { addTlsToTunnel } from './extensions/add-tls-to-tunnel'
import { makeRpcTcpTunnel } from './make-rpc-tcp-tunnel'

export const makeRpcTlsTunnel = addTlsToTunnel(makeRpcTcpTunnel)