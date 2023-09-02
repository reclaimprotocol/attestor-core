import { Logger } from 'pino'
import { ReclaimWitnessClient } from '../proto/api'
import { ProviderName, ProviderParams, providers, ProviderSecretParams } from '../providers'
import { generateProviderReceipt } from './generate-provider-receipt'

export interface MockCreateClaimOptions<N extends ProviderName> {
	/** name of the provider to generate signed receipt for */
	name: N

	params: ProviderParams<N>
	/**
	 * secrets that are used to make the API request;
	 * not included in the receipt & cannot be viewed by anyone
	 * outside this client
	 */
	secretParams: ProviderSecretParams<N>
	client: ReclaimWitnessClient

	logger?: Logger
}

export async function mockCreateClaim<Name extends ProviderName>({
	name,
	params,
	secretParams,
	client,
	logger,
}: MockCreateClaimOptions<Name>) {
	const { receipt } = await generateProviderReceipt({
		name,
		secretParams,
		params,
		client,
		logger,
	})

	const provider = providers[name]
	await provider.assertValidProviderReceipt(
		receipt!,
		// @ts-ignore
		params
	)

	return { receipt }
}