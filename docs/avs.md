# AVS

We use Eigen's AVS to decentralize the validation of reclaim data.
AVS stands for Actively Validated Service. You can read more about it [here](https://docs.eigenlayer.xyz/eigenlayer/avs-guides/avs-developer-guide).

## Stack

The AVS is built on the stack Eigen provides in their [Hello world AVS](https://github.com/Layr-Labs/hello-world-avs)

1. [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
2. [Foundry](https://getfoundry.sh/)
3. [Docker](https://www.docker.com/get-started/)
    3.1 Make sure Docker is running

## Creating a claim on the AVS

To create a claim on the AVS, you can use the `createClaimOnAvs` function. 

``` ts
import { createClaimOnAvs } from '@reclaimprotocol/witness-sdk'

createClaimOnAvs({
	// the claim owner -- the private key of the owner
	ownerPrivateKey: '0xABCD...',
	// which chain will be used to validate the claim
	// 17000 is the chainId for the Holesky testnet
	chainId: '17000',
	// provider name
	name: 'http',
	// same claim parameters as the witness
	params: {
		url: 'https://example.com',
		method: 'GET',
		responseRedactions: [],
		responseMatches: [
			{
				type: 'contains',
				value: 'test'
			}
		]
	},
	secretParams: {
		cookie: 'secret'
	},
})
```

Do note: the owner of the claim must have enough ETH to pay for the gas & claim fees (Presently there is no claim fee). If the owner wallet does not have enough ETH, a witness server can be requested to pay for the fees.

``` ts
createClaimOnAvs({
	...
	// specify the RPC URL of the witness server that will pay for the fees
	payer: { witness: 'wss://witness.example.com' }
})
```

Do note: the witness can reject the request to pay for the fees if they do not wish to subsidize the claim. The official Reclaim witness at `wss://witness.reclaimprotocol.org/ws` does subsidize the claim fees.

If you're using the browser-rpc API, then the process is very similar to single witness claim creation. All you really have to do is change the `type` to `createClaimOnAvs`, and add a `chainId` field to the request.

You can still ask the witness to pay for the fees by setting the `payer` field to `witness`.

```ts
import type { WindowRPCIncomingMsg } from '@reclaimprotocol/witness-sdk'

const req: WindowRPCIncomingMsg = {
	// lets the window know this is a request
	// intended for it
	module: 'witness-sdk',
	// this is a random ID you generate,
	// use to match the response to the request
	id: '123',
	// the type of request you want to make
	type: 'createClaimOnAvs',
	request: {
		name: 'http',
		params: {
			"url": "https://bookface.ycombinator.com/home",
			"method": "GET",
			"responseSelections": [
				{
					"jsonPath": "$.currentUser",
					"xPath": "//*[@id='js-react-on-rails-context']",
					"responseMatch": "{\"id\":111111,.*?waas_admin.*?:{.*?}.*?:{.*?}.*?(?:full_name|first_name).*?}"
				}
			]
		},
		secretParams: {
			cookieStr: '<cookie-str>'
		},
		ownerPrivateKey: '0x1234...',
		// limit ZK proof concurrency
		// to limit memory consumption
		// as webview has max 500mb memory
		zkProofConcurrency: 1,

		chainId: '17000',
		// let the witness be the payer
		payer: 'witness',
	}
}
webviewRef.current?.postMessage(JSON.stringify(req))
```

## Operating a Node on the Reclaim AVS

Presently, the AVS is only available on the Holesky testnet & only whitelisted nodes can participate in the AVS. If you're interested in participating, please reach out to us [here](TODO).

Regardless, if you're one of the chosen few -- here's how you can register yourself on the AVS:

1. Clone the repository
2. Run `npm install`
3. Deploy the Reclaim operator on the cloud or some server. See [here](/docs/project.md#deploying-to-the-cloud) for more information.
	- Note the RPC URL from this step & ensure that the operator is running & accessible on the internet.
4. Setup the environment variables in a `.env` file. Refer to our [environment variables guide](./env.md) for more information.
	- Ensure that the address of the private key you're using is whitelisted on the AVS
	- Also ensure there's enough ETH in the account to pay for gas & staking
	- Set the `CHAIN_ID` to `0x539` for holesky
	- Ensure `RECLAIM_PUBLIC_URL` is set to the public URL of the operator you deployed in step 3.
4. Run `npm run register:avs-operator`
	- Note: if your env is setup with a `.production` suffix, you'll need to run the above command with the `NODE_ENV=production` env flag.
	- Also, if you're already registered -- this command will update your metadata on the AVS.
5. If all goes well, you should be successfully registered on the AVS.
6. Check your registration status by running `npm run check:avs-registration`.
	- (this'll access the config from the environment variables)
7. Whenever you run the Reclaim operator now (using `npm run start`), users will be able to discover your node & generate proofs.

## Working on the AVS

1. Clone the repository
2. Run `npm install`
3. Install the submodules with `git submodule update --init --recursive`
	- this'll enable you to work on the contracts
4. Run `npm run start:chain` to start the local chain with the contracts already deployed

**Building the contracts**:
	- `npm run build:contracts`
**Deploying the contracts locally**:
	- `npm run deploy:contracts`
	- This will deploy the contracts on the local anvil network, and save the state of the contracts.
**Testing**:
	- `npm run test` to run all the tests
	- `npm run test:avs` to run the AVS tests