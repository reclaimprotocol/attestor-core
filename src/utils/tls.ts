import { CipherSuite, SUPPORTED_NAMED_CURVES, TLSConnectionOptions } from '@reclaimprotocol/tls'
import { detectEnvironment } from 'src/utils/env'

// we only support the following cipher suites
// for ZK proof generation
const ZK_CIPHER_SUITES: CipherSuite[] = [
	// chacha-20
	'TLS_CHACHA20_POLY1305_SHA256',
	'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
	'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
	// aes-256
	'TLS_AES_256_GCM_SHA384',
	'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
	'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
	// aes-128
	'TLS_AES_128_GCM_SHA256',
	'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
	'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
]

const NAMED_CURVE_LIST = detectEnvironment() === 'node'
	? SUPPORTED_NAMED_CURVES
	// X25519 is not supported in the browser
	: SUPPORTED_NAMED_CURVES.filter(c => c !== 'X25519')

export function getDefaultTlsOptions(): TLSConnectionOptions {
	return {
		cipherSuites: ZK_CIPHER_SUITES,
		namedCurves: NAMED_CURVE_LIST,
	}
}