import type { ProviderClaimData } from '../proto/api'
import type { IWitnessClient } from './client'
import type { Logger } from './general'
import type { ProofGenerationStep, ProviderName, ProviderParams, ProviderSecretParams } from './providers'
import type { PrepareZKProofsBaseOpts } from './zk'

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


export type CreateClaimOnWitnessOpts<N extends ProviderName> = {
	/** name of the provider to generate signed receipt for */
	name: N
	/**
	 * secrets that are used to make the API request;
	 * not included in the receipt & cannot be viewed by anyone
	 * outside this client
	 */
	secretParams: ProviderSecretParams<N>
	params: ProviderParams<N>
	/**
	 * Some metadata context to be included in the claim
	 */
	context?: { [key: string]: any }

	onStep?(step: ProofGenerationStep): void
	/**
	 * Private key in hex format,
	 * prefixed with '0x'
	 */
	ownerPrivateKey: string
	/**
	 * Provide either the client or the URL
	 * to the witness server -- so a client can
	 * be created internally.
	 *
	 * The created client will go into the global witness
	 * client pool.
	 */
	client: IWitnessClient | { url: string | URL }

	logger?: Logger
} & PrepareZKProofsBaseOpts