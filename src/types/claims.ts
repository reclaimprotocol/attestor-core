import { ProviderClaimData } from '../proto/api'

/**
 * Uniquely identifies a claim.
 * Hash of claim info.
 * Utilise `getIdentifierFromClaimInfo` to obtain this.
 */
export type ClaimID = ProviderClaimData['identifier']

export type ClaimInfo = Pick<ProviderClaimData, 'context' | 'provider' | 'parameters'>

export type AnyClaimInfo = ClaimInfo | { identifier: ClaimID }

export type CompleteClaimData = Pick<ProviderClaimData, 'owner' | 'timestampS' | 'epoch'>
	& AnyClaimInfo

export type SignedClaim = {
	claim: CompleteClaimData
	signatures: Uint8Array[]
}

export type AuthToken = {
	/** wallet address of the user */
	id: string
	/** unix timestamp in seconds */
	expiresAtS: number
}

export type EncryptedClaimProof = {
	identifier: ClaimID
	enc: Uint8Array
}

export type ClaimProof = {
	parameters: string
	signatures: Uint8Array[]
}