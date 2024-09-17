import { strToUint8Array } from '@reclaimprotocol/tls'
import { IncomingMessage } from 'http'
import { RPCMessages, ServiceSignatureType } from 'src/proto/api'
import { AttestorError } from 'src/utils'
import { getEnvVariable } from 'src/utils/env'
import { SIGNATURES } from 'src/utils/signatures'

const PRIVATE_KEY = getEnvVariable('PRIVATE_KEY')!

/**
 * Sign message using the PRIVATE_KEY env var.
 */
export function signAsAttestor(
	data: Uint8Array | string,
	scheme: ServiceSignatureType
) {
	const { sign } = SIGNATURES[scheme]
	return sign(
		typeof data === 'string' ? strToUint8Array(data) : data,
		PRIVATE_KEY
	)
}

/**
 * Obtain the address on chain, from the PRIVATE_KEY env var.
 */
export function getAttestorAddress(scheme: ServiceSignatureType) {
	const { getAddress, getPublicKey } = SIGNATURES[scheme]
	const publicKey = getPublicKey(PRIVATE_KEY)
	return getAddress(publicKey)
}

/**
 * Nice parse JSON with a key.
 * If the data is empty, returns an empty object.
 * And if the JSON is invalid, throws a bad request error,
 * with the key in the error message.
 */
export function niceParseJsonObject(data: string, key: string) {
	if(!data) {
		return {}
	}

	try {
		return JSON.parse(data)
	} catch(e) {
		throw AttestorError.badRequest(
			`Invalid JSON in ${key}: ${e.message}`,
		)
	}
}

/**
 * Extract any initial messages sent via the query string,
 * in the `messages` parameter.
 */
export function getInitialMessagesFromQuery(req: IncomingMessage) {
	const url = new URL(req.url!, 'http://localhost')
	const messagesB64 = url.searchParams.get('messages')
	if(!messagesB64?.length) {
		return []
	}

	const msgsBytes = Buffer.from(messagesB64, 'base64')
	const msgs = RPCMessages.decode(msgsBytes)
	return msgs.messages
}