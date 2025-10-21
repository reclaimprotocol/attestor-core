import type { InitRequest } from '#src/proto/api.ts'
import { AttestorVersion, ServiceSignatureType } from '#src/proto/api.ts'

export const DEFAULT_ZK_CONCURRENCY = 10

export const RECLAIM_USER_AGENT = 'reclaim/0.0.1'

export const DEFAULT_HTTPS_PORT = 443

export const WS_PATHNAME = '/ws'

export const BROWSER_RPC_PATHNAME = '/browser-rpc'

export const DEFAULT_REMOTE_FILE_FETCH_BASE_URL = `${BROWSER_RPC_PATHNAME}/resources`

export const API_SERVER_PORT = 8001

// 10s
export const CONNECTION_TIMEOUT_MS = 10_000

export const DNS_SERVERS = [
	'8.8.8.8',
	'8.8.4.4'
]

// 10m
export const MAX_CLAIM_TIMESTAMP_DIFF_S = 10 * 60

export const CURRENT_ATTESTOR_VERSION = AttestorVersion.ATTESTOR_VERSION_3_0_0

export const DEFAULT_METADATA: InitRequest = {
	signatureType: ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH,
	clientVersion: CURRENT_ATTESTOR_VERSION,
	auth: undefined
}

export const PROVIDER_CTX = { version: CURRENT_ATTESTOR_VERSION }

export const PING_INTERVAL_MS = 10_000
/**
 * Maximum interval in seconds to wait for before assuming
 * the connection is dead
 * @default 30s
 */
export const MAX_NO_DATA_INTERVAL_MS = 30_000

export const MAX_PAYLOAD_SIZE = 512 * 1024 * 1024 // 512MB

export const DEFAULT_AUTH_EXPIRY_S = 15 * 60 // 15m

export const DEFAULT_RPC_TIMEOUT_MS = 90_000

export const TOPRF_DOMAIN_SEPARATOR = 'reclaim-toprf'

export const MAX_CERT_SIZE_BYTES = 10 * 1024 * 1024 * 1024 // 10MB

export const CERT_ALLOWED_MIMETYPES = [
	'application/x-x509-ca-cert',
	'application/x-x509-user-cert',
	'application/pkix-cert',
	'application/pkcs7-mime'
]

export const BGP_WS_URL = 'wss://ris-live.ripe.net/v1/ws/?client=reclaim-hijack-detector'