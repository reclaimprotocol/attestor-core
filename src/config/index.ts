import type { BeaconIdentifier } from '../proto/api'

export const MAX_ZK_CHUNKS = 40

export const DEFAULT_ZK_CONCURRENCY = 10

export const RECLAIM_USER_AGENT = 'reclaim/0.0.1'

export const DEFAULT_BEACON_IDENTIFIER: BeaconIdentifier = {
	type: 1,
	id: '0x1a4'
}

export const DEFAULT_PORT = 443

export const DEFAULT_REMOTE_ZK_PARAMS = {
	zkeyUrl: '/resources/{algorithm}/circuit_final.zkey',
	circuitWasmUrl: '/resources/{algorithm}/circuit.wasm',
}