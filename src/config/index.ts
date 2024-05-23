import RECLAIM_TRUSTED_WITNESS from '../beacon/reclaim-trusted/config.json'
import { type BeaconIdentifier, BeaconType } from '../proto/api'

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