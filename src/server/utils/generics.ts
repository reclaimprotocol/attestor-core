import type { IncomingMessage } from 'http'
import { Address4, Address6 } from 'ip-address'

import type { ServiceSignatureType } from '#src/proto/api.ts'
import { RPCMessages } from '#src/proto/api.ts'
import { resolveHostnames } from '#src/server/utils/dns.ts'
import { getEnvVariable } from '#src/utils/env.ts'
import { AttestorError, strToUint8Array } from '#src/utils/index.ts'
import { SIGNATURES } from '#src/utils/signatures/index.ts'

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

export async function getPublicAddresses(host: string) {
	const resolvedAddresses = await resolveHostnames(host)
	const publicAddresses = resolvedAddresses
		.filter(isPublicIpAddress)
	if(!publicAddresses.length) {
		throw AttestorError.badRequest(
			`Host "${host}" does not resolve to a public IP address`
		)
	}

	return publicAddresses
}

function isPublicIpAddress(ip: string) {
	const ipv4Address = new Address4(ip)
	if(Address4.isValid(ip)) {
		return isPublicIpv4(ipv4Address)
	}

	const ipv6Address = new Address6(ip)
	if(Address6.isValid(ip)) {
		return isPublicIpv6(ipv6Address)
	}

	return false
}

function isPublicIpv4(address: Address4) {
	return !(
		address.isPrivate()
		|| address.isLoopback()
		|| address.isLinkLocal()
		|| address.isUnspecified()
		|| address.isBroadcast()
		|| address.isMulticast()
		|| address.isCGNAT()
	)
}

function isPublicIpv6(address: Address6) {
	if(address.isMapped4()) {
		return isPublicIpv4(address.to4())
	}

	return !(
		address.isULA()
		|| address.isLoopback()
		|| address.isLinkLocal()
		|| address.isUnspecified()
		|| address.isMulticast()
		|| address.isDocumentation()
	)
}
