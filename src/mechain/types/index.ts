import type { createClaimOnAttestor } from 'src/client'
import type { CreateClaimOnAttestorOpts, ProviderName } from 'src/types'

export type CreateClaimOnMechainStep = {
    type: 'taskCreated'
    data: number
}| {
    type: 'requiredAttestorsFetched'
    data: number
} | {
    type: 'attestorFetched'
    data: string
}

export type DefaultClient = {
    url: string
}

export type CreateClaimOnMechainOpts<N extends ProviderName> = (
    Omit<CreateClaimOnAttestorOpts<N>, 'onStep' | 'client'>
) & {
    onStep?(step: CreateClaimOnMechainStep): void
    /**
     * Override the default createClaimOnAttestor function
     */
    createClaimOnAttestor?: typeof createClaimOnAttestor
    client: DefaultClient
}