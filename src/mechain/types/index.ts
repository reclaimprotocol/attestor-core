import type { createClaimOnAttestor } from 'src/client'
import type { CreateClaimOnAttestorOpts, ProviderName } from 'src/types'


export type CreateClaimOnMechainOpts<N extends ProviderName> = (
    Omit<CreateClaimOnAttestorOpts<N>, 'onStep' | 'client'>
) & {
    /**
     * Override the default createClaimOnAttestor function
     */
    createClaimOnAttestor?: typeof createClaimOnAttestor
}