# Migration from Witness SDK

If you integrated the Witness SDK in your project, i.e. before 17 Sep 2024, you can refer to this guide to migrate to the `attestor-core` SDK. The changes are purely nomeclature based & the core functionality remains the same.

## As a Server

Nothing changes for you as a server. The attestor server is compatible with the Witness SDK & the `attestor-core` SDK. You can continue to run the attestor server as is.

## As a Client

The following popular functions have been renamed:
1. `createClaimOnWitness` -> `createClaimOnAttestor`
2. `getWitnessClientFromPool` -> `getAttestorClientFromPool`

The following properties have been renamed in types:
1. `WitnessData` -> `AttestorData`
2. `WitnessError` -> `AttestorError`

The following protobuf names have been changed:
1. `ClaimTunnelResponse.Signatures.witnessAddress` -> `ClaimTunnelResponse.Signatures.attestorAddress`
2. `WitnessErrorData` -> `ErrorData`
3. `WitnessErrorCode` -> `ErrorCode`
4. `WitnessVersion` -> `AttestorVersion`
5. package name `reclaim_witness` -> `reclaim_attestor`

## As a Browser-RPC Client

In each request, instead of sending `module: 'witness-sdk'`, you should send `module: 'attestor-core'`.