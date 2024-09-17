import type { ProviderClaimData } from 'src/proto/api'
import type { IAttestorClient } from 'src/types/client'
import type { CompleteTLSPacket, Logger } from 'src/types/general'
import type { ProofGenerationStep, ProviderName, ProviderParams, ProviderSecretParams } from 'src/types/providers'
import { Transcript } from 'src/types/tunnel'
import type { PrepareZKProofsBaseOpts } from 'src/types/zk'

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


export type CreateClaimOnAttestorOpts<N extends ProviderName> = {
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
	 * to the server -- so a client can be created internally.
	 *
	 * The created client will go into the global client pool.
	 */
	client: IAttestorClient | { url: string | URL }
	/**
	 * Optionally set the timestamp of the claim
	 * in unix seconds. If not provided, the current
	 * time will be used.
	 */
	timestampS?: number

	logger?: Logger
	/**
	 * Optionally update the provider parameters
	 * based on the transcript
	 */
	updateProviderParams? (transcript: Transcript<CompleteTLSPacket>, tlsVersion: string): Promise<{
		params: Partial<ProviderParams<N>>
		secretParams: Partial<ProviderSecretParams<N>>
	}>
} & PrepareZKProofsBaseOpts