import { isIP } from 'node:net'

import type { IncomingMessage } from 'http'
import { Address4, Address6 } from 'ip-address'
import { Agent, buildConnector, fetch as undiciFetch } from 'undici'

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

class UnsafeHostError extends Error {}

/**
 * Fetch a URL while preventing requests to private/reserved addresses.
 * Every connection (including redirects) is pinned to a validated public
 * address, so DNS rebinding can't bypass the check either.
 */
export async function safeFetch(
	url: string,
	init?: Parameters<typeof undiciFetch>[1]
) {
	assertHttpUrl(url)
	try {
		return await undiciFetch(url, { ...init, dispatcher: SAFE_AGENT })
	} catch(err) {
		// undici wraps connection errors as `TypeError('fetch failed')`
		if(err.cause instanceof UnsafeHostError) {
			throw AttestorError.badRequest(err.cause.message)
		}

		throw err
	}
}

function assertHttpUrl(url: string) {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw AttestorError.badRequest(`Invalid URL: ${url}`)
	}

	if(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw AttestorError.badRequest(
			`Unsupported URL protocol: ${parsed.protocol}`
		)
	}
}

/**
 * The public addresses a host maps to. Non-public ones are dropped;
 * throws if none remain.
 */
async function getSafeAddresses(host: string) {
	let addresses: string[]
	try {
		addresses = isIP(host) ? [host] : await resolveHostnames(host)
	} catch(err) {
		throw new UnsafeHostError(err.message)
	}

	const publicAddresses = addresses.filter(isPublicIpAddress)
	if(!publicAddresses.length) {
		throw new UnsafeHostError(
			`Host "${host}" does not resolve to a public IP address`
		)
	}

	return publicAddresses
}

/**
 * DNS lookup that only ever returns public addresses. The returned
 * addresses are the ones actually dialed, so there's no TOCTOU window.
 */
function safeLookup(
	hostname: string,
	options: { family?: number, all?: boolean },
	callback: (...args: any[]) => void
) {
	const host = stripIpv6Brackets(hostname)
	getSafeAddresses(host)
		.then(addresses => {
			const results = addresses
				.map(address => ({ address, family: isIP(address) }))
				.filter(r => !options?.family || r.family === options.family)
			if(!results.length) {
				throw new UnsafeHostError(
					`Host "${host}" has no public IPv${options.family} address`
				)
			}

			return results
		})
		.then(
			results => {
				if(options?.all) {
					callback(null, results)
				} else {
					callback(null, results[0].address, results[0].family)
				}
			},
			callback
		)
}

const SAFE_CONNECTOR = buildConnector({
	lookup: safeLookup as any,
	timeout: 10_000,
})

const SAFE_AGENT = new Agent({
	connect(options, callback) {
		const host = stripIpv6Brackets(options.hostname)
		// net skips the lookup hook for IP literals, so check those here
		if(isIP(host) && !isPublicIpAddress(host)) {
			callback(
				new UnsafeHostError(`Host "${host}" is not a public IP address`),
				null
			)
			return
		}

		SAFE_CONNECTOR(options, callback)
	},
})

function stripIpv6Brackets(host: string) {
	return host.startsWith('[') && host.endsWith(']')
		? host.slice(1, -1)
		: host
}

function isPublicIpAddress(ip: string) {
	if(Address4.isValid(ip)) {
		return new Address4(ip).isGlobal()
	}

	if(Address6.isValid(ip)) {
		return new Address6(ip).isGlobal()
	}

	return false
}

/**
 * Match a host against a whitelist pattern. Patterns may be an exact
 * hostname or a leading-wildcard form like `*.example.com`, which matches
 * the apex and any subdomain depth. Comparison is case-insensitive.
 */
export function matchesHostPattern(pattern: string, host: string): boolean {
	const p = pattern.toLowerCase()
	const h = host.toLowerCase()
	if(p.startsWith('*.')) {
		const suffix = p.slice(2)
		return h === suffix || h.endsWith('.' + suffix)
	}

	return p === h
}
