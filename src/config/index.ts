import { AttestorVersion, InitRequest, ServiceSignatureType } from 'src/proto/api'

export const MAX_ZK_CHUNKS = 200

export const DEFAULT_ZK_CONCURRENCY = 10

export const RECLAIM_USER_AGENT = 'reclaim/0.0.1'

export const DEFAULT_HTTPS_PORT = 443

export const WS_PATHNAME = '/ws'

export const BROWSER_RPC_PATHNAME = '/browser-rpc'

export const DEFAULT_REMOTE_ZK_PARAMS = {
	zkeyUrl: `${BROWSER_RPC_PATHNAME}/resources/{algorithm}/circuit_final.zkey`,
	circuitWasmUrl: `${BROWSER_RPC_PATHNAME}/resources/{algorithm}/circuit.wasm`,
}

export const API_SERVER_PORT = 8001

// 10s
export const CONNECTION_TIMEOUT_MS = 10_000

export const DNS_SERVERS = [
	'8.8.8.8',
	'8.8.4.4'
]

// 10m
export const MAX_CLAIM_TIMESTAMP_DIFF_S = 10 * 60

export const DEFAULT_METADATA: InitRequest = {
	signatureType: ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH,
	clientVersion: AttestorVersion.ATTESTOR_VERSION_2_0_0
}

export const PING_INTERVAL_MS = 10_000
/**
 * Maximum interval in seconds to wait for before assuming
 * the connection is dead
 * @default 30s
 */
export const MAX_NO_DATA_INTERVAL_MS = 30_000