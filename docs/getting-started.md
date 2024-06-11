# Getting Started

This guide will help you get started with the Reclaim protocol on either the browser or NodeJS. For React Native & mobile devices, refer to our [React Native guide](docs/browser-rpc.md).

Once you've installed the SDK (see main readme), you can start creating claims.

## Code

```ts
import { createClaimOnWitness } from '@reclaimprotocol/witness-sdk'

const rslt = await createClaimOnWitness({
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
	// specify the address of the witness to use
	client: { url: 'wss://witness.reclaimprotocol.org/ws' }
})

// if the witness failed to find a proof in your claim --
// it'll return an error. If the witness failed to even process
// your request, the 'createClaim' function will throw an error.
if(rslt.error) {
	console.error('error in creating claim', rslt.error)
	return
}

// if the witness successfully processed your request, it'll return
// the claim & the signature of the claim
console.log('created claim: ', rslt.claim)
console.log('claim signature: ', rslt.signatures.claimSignature)
```

Voila! You've created your first claim. Now, anybody (including you) can verify this claim by using the signature & the claim.
``` ts
import { assertValidClaimSignatures } from '@reclaimprotocol/witness-sdk'

// this will throw an error if the claim or result is invalid
await assertValidClaimSignatures(rslt)

// the above function will validate the entire create claim
// response -- including the signature of the response & the claim.
// If you'd like to validate only the claim, you can do so by
// only passing the claim & the signature of the claim
await assertValidClaimSignatures({
	claim: rslt.claim,
	signatures: {
		claimSignature: rslt.signatures.claimSignature,
		witnessAddress: rslt.signatures.witnessAddress
	}
})
```

If you'd like to actually view the transcript of the claim that the witness saw & made a claim on, you can do so by accessing the `transcript` field in the result. This is a good way to verify your code isn't leaking any sensitive information.

``` ts
import { decryptTranscript } from '@reclaimprotocol/witness-sdk'

const decTranscript = await decryptTranscript(
	// "rslt" is the result from the createClaim function
	rslt.request?.transcript!,
	logger
)
// convert the transcript to a string for easy viewing
const transcriptStr = getTranscriptString(decTranscript)
console.log('receipt:\n', transcriptStr)
```

### Using the Witness Client

If you notice, the `createClaimOnWitness` function takes a `client` parameter. This is the witness client that the SDK uses to connect to the witness.

If you don't have an existing client & want to create a claim -- it is recommended to simply pass the URL of the witness you want to connect to. The SDK will automatically create a client for you & store it in the pool. So, the next time you create a claim, the SDK will reuse the client.

The other advantage of this approach, is that the SDK will condense the creation of the client, the connection to the end server & TLS hello into a single message. This speeds up the process of creating a claim as the number of round trips is reduced. More on this in the [RPC protocol docs](docs/rpc.md).

However, if you want to manage the client yourself, you can do so by creating a client & passing it to the `createClaimOnWitness` function. This is useful if you want to reuse the client for multiple claims or if you want to manage the client's lifecycle yourself.

``` ts
import { WitnessClient, createClaimOnWitness } from '@reclaimprotocol/witness-sdk'

const client = new WitnessClient({
	// some other witness can be used here
	url: 'wss://witness.reclaimprotocol.org/ws'
})
const rslt = await createClaimOnWitness({
	name: 'http',
	params: { ... },
	secretParams: { ... },
	ownerPrivateKey: '0x1234...',
	client
})
```

## CLI

Alternatively, you can use the CLI to create a claim:

```sh
npm run create:claim --json some-claim-params.json
```

Ensure you have an `.env.development` file with at least the `PRIVATE_KEY` set. See the [.env.sample](.env.sample) file to see all available options.

To use a different environment file, you can specify it using:
```sh
NODE_ENV=production npm run create:claim ...
```

The JSON is a file containing the claim parameters. The JSON should look like this:

```json
{
	"name": "http",
	"params": {
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
	"secretParams": {
		"cookieStr": "<cookie-str>"
	}
}
```

Examples can be found in the [examples](/example) directory.

To connect to another witness, you can specify the `--witness` CLI flag:

``` sh
npm run create:claim --json some-claim-params.json --witness ws://localhost:8001/ws
```

Pass `local` to use the local witness. This'll be run automatically when you run the command. Eg.
``` sh
npm run create:claim --json some-claim-params.json --witness local
```
