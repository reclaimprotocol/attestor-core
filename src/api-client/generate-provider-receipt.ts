import { strToUint8Array } from '@reclaimprotocol/tls'
import { DEFAULT_PORT } from '../config'
import { ProviderName, ProviderParams, providers, ProviderSecretParams } from '../providers'
import { logger as MAIN_LOGGER, makeHttpResponseParser } from '../utils'
import { BaseAPIClientOptions, makeAPITLSClient } from './make-api-tls-client'

export type GenerateProviderReceiptOptions<N extends ProviderName> = {
	/** name of the provider to generate signed receipt for */
	name: N
	/**
	 * secrets that are used to make the API request;
	 * not included in the receipt & cannot be viewed by anyone
	 * outside this client
	 */
	secretParams: ProviderSecretParams<N>
	params: ProviderParams<N>
} & BaseAPIClientOptions

export async function generateProviderReceipt<Name extends ProviderName>({
	name,
	secretParams,
	params,
	logger,
	additionalConnectOpts,
	...opts
}: GenerateProviderReceiptOptions<Name>) {
	logger = logger || MAIN_LOGGER
	const provider = providers[name]

	const hostPort = typeof provider.hostPort === 'function'
		// @ts-ignore
		? provider.hostPort(params)
		: provider.hostPort


	additionalConnectOpts = {
		...provider.additionalClientOptions || {},
		...additionalConnectOpts,
	}
	if(provider.additionalClientOptions?.rootCAs) {
		additionalConnectOpts.rootCAs = [
			...(additionalConnectOpts.rootCAs || [ ]),
			...provider.additionalClientOptions.rootCAs,
		]
	}

	const [host, port] = hostPort.split(':')
	const resParser = makeHttpResponseParser()
	const apiClient = makeAPITLSClient({
		host,
		port: port ? +port : DEFAULT_PORT,
		logger,
		additionalConnectOpts,
		defaultWriteRedactionMode: provider.defaultRedactionMode,
		...opts,
		handleDataFromServer(data) {
			resParser.onChunk(data)
			if(resParser.res.complete) {
				logger?.debug('got complete HTTP response from server')
				// wait 1 tick to make sure the client has
				// finished writing the response
				setTimeout(() => {
					endedHttpRequest?.()
				}, 100)
			}
		},
		onTlsEnd(err) {
			const level = err ? 'error' : 'debug'
			logger?.[level]({ err }, 'tls session ended')
			endedHttpRequest?.(err)
			try {
				resParser.streamEnded()
			} catch{ }
		},
		redactResponse:
			provider.getResponseRedactions
				? res => {
					// @ts-ignore
					return provider.getResponseRedactions!(res, params)
				}
				: undefined
	})

	let endedHttpRequest: ((err?: Error) => void) | undefined
	const request = provider.createRequest(
		// @ts-ignore
		secretParams,
		params
	)

	logger.debug(
		{ redactions: request.redactions.length },
		'generated request'
	)

	const waitForRequestEnd = new Promise<void>(
		(resolve, reject) => {
			endedHttpRequest = err => (
				err ? reject(err) : resolve()
			)
		}
	)

	await apiClient.connect()

	const reqData = typeof request.data === 'string'
		? strToUint8Array(request.data)
		: request.data
	await apiClient.write(reqData, request.redactions)

	logger.info('wrote request to server')

	await waitForRequestEnd

	const res = await apiClient.finish()

	logger.info({ claimData: res.claimData }, 'finished request')

	return res
}
