import { Provider } from '../../types'
import HTTP_PROVIDER, { HTTPProviderParams, HTTPProviderSecretParams } from '.'

type WrapInHttpProviderOpts<P extends { [_: string]: unknown }, SP> = {
	getParams: (params: P) => HTTPProviderParams
	getSecretParams: (params: SP) => HTTPProviderSecretParams
	areValidParams: Provider<P, SP>['areValidParams']
}

/**
 * Wrap a provider in an HTTP provider
 */
export function wrapInHttpProvider<P extends { [_: string]: unknown }, SP>({
	getParams,
	getSecretParams,
	areValidParams,
}: WrapInHttpProviderOpts<P, SP>): Provider<P, SP> {
	return {
		hostPort(params: P) {
			if(typeof HTTP_PROVIDER.hostPort === 'string') {
				return HTTP_PROVIDER.hostPort
			}

			return HTTP_PROVIDER.hostPort(getParams(params))
		},
		areValidParams: areValidParams,
		createRequest(secretParams, params) {
			return HTTP_PROVIDER.createRequest(
				getSecretParams(secretParams),
				getParams(params)
			)
		},
		assertValidProviderReceipt(receipt, params) {
			return HTTP_PROVIDER.assertValidProviderReceipt(receipt, getParams(params))
		},
		getResponseRedactions(response, params) {
			return HTTP_PROVIDER.getResponseRedactions!(response, getParams(params))
		},
	}
}