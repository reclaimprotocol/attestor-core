import { strToUint8Array } from '@reclaimprotocol/tls'
import canonicalize from 'canonicalize'
import { utils } from 'ethers'
import { DEFAULT_METADATA } from 'src/config'
import { ClaimTunnelResponse } from 'src/proto/api'
import { ClaimID, ClaimInfo, CompleteClaimData, ProviderParams } from 'src/types'
import { SIGNATURES } from 'src/utils/signatures'

/**
 * Creates the standard string to sign for a claim.
 * This data is what the attestor will sign when it successfully
 * verifies a claim.
 */
export function createSignDataForClaim(data: CompleteClaimData) {
	const identifier = 'identifier' in data
		? data.identifier
		: getIdentifierFromClaimInfo(data)
	const lines = [
		identifier,
		// we lowercase the owner to ensure that the
		// ETH addresses always serialize the same way
		data.owner.toLowerCase(),
		data.timestampS.toString(),
		data.epoch.toString(),
	]

	return lines.join('\n')
}

/**
 * Verify the claim tunnel response from a attestor.
 *
 * If you'd only like to verify the claim signature, you can
 * optionally only pass "claim" & "signatures.claimSignature"
 * to this function.
 *
 * The successful run of this function means that the claim
 * is valid, and the attestor that signed the claim is valid.
 */
export async function assertValidClaimSignatures(
	{
		signatures,
		...res
	}: Partial<ClaimTunnelResponse>,
	metadata = DEFAULT_METADATA
) {
	if(!signatures) {
		throw new Error('No signatures provided')
	}

	const {
		resultSignature,
		claimSignature,
		attestorAddress
	} = signatures

	const { verify } = SIGNATURES[metadata.signatureType]
	if(signatures?.resultSignature) {
		const resBytes = ClaimTunnelResponse.encode(
			ClaimTunnelResponse.create(res)
		).finish()
		const verified = await verify(
			resBytes,
			resultSignature,
			attestorAddress
		)
		if(!verified) {
			throw new Error('Invalid result signature')
		}
	}

	// claim wasn't generated -- i.e. the transcript
	// did not contain the necessary data
	if(!res.claim) {
		return
	}

	const signData = createSignDataForClaim(res.claim)
	const verifiedClaim = await verify(
		strToUint8Array(signData),
		claimSignature,
		attestorAddress
	)
	if(!verifiedClaim) {
		throw new Error('Invalid claim signature')
	}
}

/**
 * Generates a unique identifier for given claim info
 * @param info
 * @returns
 */
export function getIdentifierFromClaimInfo(info: ClaimInfo): ClaimID {
	//re-canonicalize context if it's not empty
	if(info.context?.length > 0) {
		try {
			const ctx = JSON.parse(info.context)
			info.context = canonicalStringify(ctx)!
		} catch(e) {
			throw new Error('unable to parse non-empty context. Must be JSON')
		}

	}

	const str = `${info.provider}\n${info.parameters}\n${info.context || ''}`
	//console.log('Identifier: ' + btoa(str))
	return utils.keccak256(
		strToUint8Array(str)
	).toLowerCase()
}

/**
 * Canonically stringifies an object, so that the same object will always
 * produce the same string despite the order of keys
 */
export function canonicalStringify(params: { [key: string]: any } | undefined) {
	if(!params) {
		return ''
	}

	return canonicalize(params) || ''
}

export function hashProviderParams(params: ProviderParams<'http'>): string {
	const filteredParams = {
		url:params.url,
		method:params.method,
		body: params.body,
		responseMatches: params.responseMatches,
		responseRedactions: params.responseRedactions
	}

	const serializedParams = canonicalStringify(filteredParams)
	return utils.keccak256(
		strToUint8Array(serializedParams)
	).toLowerCase()
}