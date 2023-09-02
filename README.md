# Reclaim Node

The node acts as an oracle for the on-chain smart contract. Users must interact with this node to generate signed credentials which they can then pass to the smart contract to mint credentials

The oracle & client communicate via gRPC. The protobuf file laying out the service can be found in `proto/api.proto`

## Usage

1. Install in your project using `npm install @reclaimprotocol/reclaim-node` (TODO)
2. Example of minting a credential:

   ```ts
   import { Wallet } from 'ethers'
   import {
   	createClaim,
   	getContract,
   	makeSmartContractMint,
   } from '@reclaimprotocol/reclaim-node'
   // your wallet address,
   // ensure it has enough balance to pay the mint fees
   const meWallet = new Wallet('0x1234...')
   // chain ID for the goerli testnet
   const goerliChainId = 0x5

   const {
   	// data describing the minted credential
   	claimData,
   	// signatures returned by oracles
   	signatures,
   } = await createClaim({
   	name: 'google-login',
   	params: { emailAddress: 'abcd@creatoros.co' },
   	secretParams: { googleToken: 'api-token' },
   	requestMint: makeSmartContractMint({
   		chainId: goerliChainId,
   		signer: meWallet,
   	}),
   })
   ```

## Setup Node

1. Clone the repository
2. CD into this folder (`node`)
3. Run `npm run install:deps` to install dependencies
4. Install `protoc`. See [here](https://grpc.io/docs/protoc-installation/)
5. Run the following scripts:
   - `npm run generate:proto` to generate the protobuf typings
   - `npm run generate:contracts-data` to copy in the ABI & types for the contracts
6. You can now run this node
   - Run `npm run test` to run the test suite
   - Run `npm run start:tsc` to start the oracle's gRPC server
     - Run with `NODE_ENV=test npm run start:tsc` to run in a test/dev environment

**Note:** To be an oracle -- all nodes must expose a gRPC web endpoint. This endpoint shall be pushed to the smart contract as the "oracle hostname:port". The gRPC Web endpoint is mandatory, as it permits browsers to interact with the service directly

## Testing Providers Locally

1. We've provided a CLI tool to run a server and generate receipts locally for any provider.
   - This script can be run via `npm run generate:local-receipt -- --json provider-params.json`
   - It takes in either a JSON input like demonstrated above or can even take in the individual parameters in the command's arguments. For eg.
   ```sh
   	npm run generate:local-receipt -- \
   	--name 'github-commits' \
   	--params '{
   "name": "github-commits",
   "params": {
   	"repository": "reclaimprotocol/reclaim-sdk",
   	"searchQuery": {
   		"keywords": [],
   		"qualifiers": {
   			"is": ["pr", "merged"]
   		}
   	},
   	"type": "github-pull-requests"
   },
   "secretParams": {
   	"token": "{{GH_TOKEN}}"
   }
   }' \
   	--secretParams '{"token":"{{GH_TOKEN}}"'
   ```
   - The command can take in variables from your environment as well. By default the `.env` file. These variables must be mustache encoded, for eg. `{{GH_TOKEN}}`
2. We've provided such an example for github, which you can run via `npm run example:github-claim`

## Applications

An "application" in reclaim's context is simply a provider for some reputation or credential.

For example, you could have an application termed "google-login" that is configured to verify claims of ownership of google accounts. (PS: this has actually been implemented here)

The library makes it fairly simple to add new applications for particular use cases. Here is how you can add your own:

1. Any new application must conform to the `Application` interface
   ```ts
   interface Application<
   	Params extends { [_: string]: unknown },
   	SecretParams
   > {
   	/**
   	 * host:port pairs considered valid for this application;
   	 * the protocol establishes a connection to the first one
   	 * when a request is received from a user
   	 * Eg. ["www.google.com:443"]
   	 * */
   	hostPorts: string[]
   	/** extra options to pass to the client like root CA certificates */
   	additonalClientOptions?: TLSConnectionOptions
   	/** check the parameters are valid */
   	areValidParams(params: { [_: string]: unknown }): params is Params
   	/** generate the raw request to be sent to through the TLS receipt */
   	createRequest(params: SecretParams): {
   		data: Uint8Array
   		redactions: ArraySlice[]
   	}
   	/**
   	 * verify a generated TLS receipt against given parameters
   	 * to ensure the receipt does contain the credentials the
   	 * user is claiming to have
   	 * @param receipt the TLS receipt to verify
   	 * @param params the parameters to verify the receipt against. Eg. `{"email": "abcd@gmail.com"}`
   	 * */
   	assertValidApplicationReceipt(
   		receipt: TLSReceipt,
   		params: Params
   	): void | Promise<void>
   }
   ```
2. Should default export the newly constructed application
3. Should kebab case the file name & store it in `src/applications/{app-name}.ts`
4. Finally, export this new application from `src/applications/index.ts`

See [google-login.ts](/node/src/providers/google-login.ts) as an example of a working implementation.

## Considerations & tests

It's crucial to process `redactions` correctly when creating a request.
Make sure & double check that PII data like oauth tokens & passwords are processed correctly.

Each application should have test in `tests` folder. `redactions` and `assertValidApplicationReceipt` should be the first things to test

## Troubleshooting

### Common Errors

#### "Root CA not found. Could not verify certificate"

This means that the root CA for the domain you're trying to connect to has not been added to the reclaim node. We have the Mozilla root CA list by default, but if this error occurs, you'll need to add the root CA for the domain you're trying to connect to.

To add a root CA, follow these steps:

1. If you don't know what a root CA is, read [this](https://comodosslstore.com/resources/what-is-a-root-ca-certificate-and-how-do-i-download-it/)
2. Run `npm run verify-root-ca {host}`
	- `{host}` is the host you're trying to connect to, which results in the error
	- At the end of the script, you'll see a log like:
		``` json
		{"level":30,"time":1686473965567,"pid":8408,"hostname":"192.168.1.10","err":"Root CA not found. Could not verify certificate","rootIssuer":{"attributes":[{"type":"2.5.4.10","value":"Digital Signature Trust Co.","valueTagClass":19,"name":"organizationName","shortName":"O"},{"type":"2.5.4.3","value":"DST Root CA X3","valueTagClass":19,"name":"commonName","shortName":"CN"}],"hash":"6ff4684d4312d24862819cc02b3d472c1d8a2fa6"},"msg":"error in cert verify"}
		```
	- Copy the `commonName` object from the log (`DST Root CA X3` in the above log). This is the name of the root CA.
3. Find the root CA certificate online using the name you copied
	- http://www.certificate.fyicenter.com/ is a good resource
4. Copy the certificate in PEM format
5. Paste in the `src/tls/root-ca.ts` file, in the `ROOT_CA_LIST` array
6. Run `npm run verify-root-ca {host}`. This time, it should succeed & you won't see an error at the bottom of the log
		

	