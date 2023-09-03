import { strToUint8Array } from '@reclaimprotocol/tls'
import canonicalize from 'canonicalize'
import { utils } from 'ethers'
import { ClaimID, ClaimInfo, CompleteClaimData } from '../types'

export function createSignDataForClaim(
	data: CompleteClaimData
) {
	const identifier = 'identifier' in data
		? data.identifier
		: getIdentifierFromClaimInfo(data)
	const lines = [
		identifier,
		data.owner.toLowerCase(),
		data.timestampS.toString(),
		data.epoch.toString(),
	]

	return lines.join('\n')
}

/**
 * Generates a unique identifier for given claim info
 * @param info
 * @returns
 */
export function getIdentifierFromClaimInfo(info: ClaimInfo): ClaimID {
	const str = `${info.provider}\n${info.parameters}\n${info.context || ''}`
	return utils.keccak256(
		strToUint8Array(str)
	).toLowerCase()
}

export function stringifyClaimParameters(params: { [key: string]: any }) {
	return canonicalize(params) || ''
}