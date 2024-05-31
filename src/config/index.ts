import RECLAIM_TRUSTED_WITNESS from '../beacon/reclaim-trusted/config.json'
import { type BeaconIdentifier, BeaconType, InitRequest, ServiceSignatureType, WitnessVersion } from '../proto/api'

export const MAX_ZK_CHUNKS = 40

export const DEFAULT_ZK_CONCURRENCY = 10

export const RECLAIM_USER_AGENT = 'reclaim/0.0.1'

export const DEFAULT_BEACON_IDENTIFIER: BeaconIdentifier = {
	type: BeaconType.BEACON_TYPE_RECLAIM_TRUSTED,
	id: RECLAIM_TRUSTED_WITNESS.id
}

export const DEFAULT_HTTPS_PORT = 443

export const DEFAULT_REMOTE_ZK_PARAMS = {
	zkeyUrl: '/resources/{algorithm}/circuit_final.zkey',
	circuitWasmUrl: '/resources/{algorithm}/circuit.wasm',
}

export const API_SERVER_PORT = 8001

// 10s
export const CONNECTION_TIMEOUT_MS = 10_000

export const DNS_SERVERS = [
	'2401:4900:50:9::290',
	'2401:4900:50:9::280',
	'fe80::1'
]

// 10m
export const MAX_CLAIM_TIMESTAMP_DIFF_S = 10 * 60

export const WS_PATHNAME = '/ws'

export const BROWSER_RPC_PATHNAME = '/browser-rpc'

export const DEFAULT_METADATA: InitRequest = {
	signatureType: ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH,
	clientVersion: WitnessVersion.WITNESS_VERSION_2_0_0
}
