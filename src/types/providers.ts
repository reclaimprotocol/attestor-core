import type { TLSConnectionOptions } from '@reclaimprotocol/tls'
import type { AttestorVersion, ProviderClaimData } from 'src/proto/api'
import type { ArraySlice, Logger, RedactedOrHashedArraySlice } from 'src/types/general'
import type { ProvidersConfig } from 'src/types/providers.gen'
import type { Transcript } from 'src/types/tunnel'

export type AttestorData = {
	id: string
	url: string
}

type CreateRequestResult = {
  /**
   * Raw request to be sent
   * If a string, it is assumed to be an
   * ASCII encoded string. If it contains
   * non-ASCII characters, the redactions
   * may not work as expected
   */
  data: Uint8Array | string
  redactions: ArraySlice[]
}

export type ProviderName = keyof ProvidersConfig

export type ProviderParams<T extends ProviderName> = ProvidersConfig[T]['parameters']

export type ProviderSecretParams<T extends ProviderName> = ProvidersConfig[T]['secretParameters']

export type RedactionMode = 'key-update' | 'zk'

export type ProviderField<Params, SecretParams, T> = T | ((params: Params, secretParams?: SecretParams) => T)

export type ProviderCtx = {
  version: AttestorVersion
}

type GetResponseRedactionsOpts<P> = {
  response: Uint8Array
  params: P
  logger: Logger
  ctx: ProviderCtx
}

type AssertValidProviderReceipt<P> = {
  receipt: Transcript<Uint8Array>
  params: P
  logger: Logger
  ctx: ProviderCtx
}

/**
 * Generic interface for a provider that can be used to verify
 * claims on a TLS receipt
 *
 * @notice "Params" are the parameters you want to claim against.
 * These would typically be found in the response body
 *
 * @notice "SecretParams" are the parameters that are used to make the API request.
 * These must be redacted in the request construction in "createRequest" & cannot be viewed by anyone
 */
export interface Provider<
  N extends ProviderName,
  Params = ProviderParams<N>,
  SecretParams = ProviderSecretParams<N>
> {
  /**
   * host:port to connect to for this provider;
   * the protocol establishes a connection to the first one
   * when a request is received from a user.
   *
   * Run on attestor side when creating a new session
   *
   * Eg. "www.google.com:443", (p) => p.url.host
   * */
  hostPort: ProviderField<Params, SecretParams, string>
  /**
   * Which geo location to send the request from
   * Provide 2 letter country code, or a function
   * that returns the country code
   * @example "US", "IN"
   */
  geoLocation?: ProviderField<Params, SecretParams, string | undefined>

  /** extra options to pass to the client like root CA certificates */
  additionalClientOptions?: ProviderField<Params, SecretParams, TLSConnectionOptions | undefined>
  /**
   * default redaction mode to use. If not specified,
   * the default is 'key-update'.
   *
   * It's switched to 'zk' for TLS1.2 requests as TLS1.2
   * don't support key updates
   *
   * @default 'key-update'
   */
  writeRedactionMode?: ProviderField<Params, SecretParams, RedactionMode | undefined>
  /** generate the raw request to be sent to through the TLS receipt */
  createRequest(
    secretParams: SecretParams,
    params: Params,
    logger: Logger
  ): CreateRequestResult
  /**
   * Return the slices of the response to redact
   * Eg. if the response is "hello my secret is xyz",
   * and you want to redact "xyz", you would return
   * [{start: 17, end: 20}]
   *
   * This is run on the client side, to selct which portions of
   * the server response to send to the attestor
   * */
  getResponseRedactions?(
    opts: GetResponseRedactionsOpts<Params>
  ): RedactedOrHashedArraySlice[]
  /**
   * verify a generated TLS receipt against given parameters
   * to ensure the receipt does contain the claims the
   * user is claiming to have
   *
   * This is run on the attestor side.
   * @param receipt application data messages exchanged in the TLS session
   * @param params the parameters to verify the receipt against.
   *  Eg. `{"email": "abcd@gmail.com"}`
   * @returns sucessful verification or throws an error message.
	 *  Optionally return parameters extracted from the receipt
	 *  that will then be included in the claim context
   * */
  assertValidProviderReceipt(
    opts: AssertValidProviderReceipt<Params>
  ): void | Promise<void> | { extractedParameters: { [key: string]: string } }
}

export type ProofGenerationStep =
  | {
    // initialise session on attestor
    // using initialiseSession RPC
    name: 'connecting'
  }
  | {
    // once connection to attestor
    // is established, send the
    // request data to the attestor
    name: 'sending-request-data'
  }
  | {
    // once all the data is sent,
    // wait for the server's response
    // to be relayed back to the client
    name: 'waiting-for-response'
  }
  | {
    // For the proofs of each block to be
    // generated, update on the progress
    name: 'generating-zk-proofs'
    proofsDone: number
    proofsTotal: number
    /**
     * approximate time left in seconds.
     * Only computed after the first block
     * is done
     * */
    approxTimeLeftS?: number
  }
  | {
    // wait for the attestor to verify
    // said proofs & receipt
    name: 'waiting-for-verification'
  }

type StepData = {
  timestampS: number
  epoch: number
  attestors: AttestorData[]
}

export type CreateStep =
  | ({ name: 'creating' } & StepData)
  | ({
    name: 'attestor-progress'
    currentAttestor: AttestorData
    step: ProofGenerationStep
  } & StepData)
  | {
      name: 'attestor-done'
      timestampS: number
      epoch: number
      attestorsLeft: AttestorData[]
      claimData: ProviderClaimData
      signaturesDone: string[]
    };