import httpProvider from './http-provider'


export const providers = {
	http: httpProvider,

}

export type ProviderName = keyof typeof providers

type Provider<E extends ProviderName> = (typeof providers)[E]

export type ProviderParams<E extends ProviderName> = Parameters<
    Provider<E>['assertValidProviderReceipt']
>[1]

export type ProviderSecretParams<E extends ProviderName> = Parameters<
    Provider<E>['createRequest']
>[0]
