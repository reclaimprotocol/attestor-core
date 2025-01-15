# Run your own Attestor

## Running a Attestor Locally

1. Of course, clone this repository.
2. Ensure you have an env file with at least the `PRIVATE_KEY` set. See the [.env.sample](.env.sample) file to see all available options.
3. Optional: build the browser RPC files with `npm run build:browser`. More on this in the [docs](docs/browser-rpc.md).
4. Run the attestor server with `npm run start:tsc`. This will start the server on port 8001 by default.

### Enabling TOPRF

We support threshholded [OPRF](https://en.wikipedia.org/wiki/Oblivious_pseudorandom_function) to obscure sensitive data in a proof in a consistent way. This is optional but requires additional setup. Here is how to enable it:
1. Create TOPRF keys with `npm run generate:toprf-keys`. This will print out environment variables required for TOPRF.
2. From the output of the above cmd, you must add:
	- `TOPRF_PUBLIC_KEY`
	- One of the key shares specified by `TOPRF_SHARE_PUBLIC_KEY` & `TOPRF_SHARE_PRIVATE_KEY`

### Enabling Authentication

When using the attestor for a private application, you may want to enable authentication & limit some endpoints. We utilise signed, limited-time data for this. This functions almost exactly like a JWT.

Enabling this will also block all un-authenticated connections to the attestor, throwing an `ERROR_AUTHENTICATION_FAILED` error.

To enable authentication:
Add the `AUTHENTICATION_PUBLIC_KEY` env flag with the public key of the signer. Note: the signature scheme is the same as the default `PRIVATE_KEY`.
``` sh
AUTHENTICATION_PUBLIC_KEY=0x123456789...
```

#### Creating an Auth Request

When creating a claim, you'll need to pass a signed request. Here is an example of how to do it:
``` ts
import { createAuthRequest, createClaim } from '@reclaimprotocol/attestor-core'

// this can happen on another server, on the client or anywhere you'd
// like
const authRequest = await createAuthRequest(
	{
		// optional user ID -- to identify the user
		// all logs on the backend will be tagged with thiss
		userId: 'optional-user-id',
		// only allow the user to tunnel requests to one of
		// these hosts
		hostWhitelist: ['api.abcd.xyz']
	},
	MY_PRIVATE_KEY
)
await createClaim({
	...otherParams,
	client: { url: 'wss://my-private-attestor.com/ws', authRequest }
})
```

#### Authenticating via the Browser RPC

If you're using the browser RPC, you can authenticate by passing the `authRequest` in the `createClaim` function. Here is an example:
``` ts
webviewRef.current?.postMessage(JSON.stringify({
	module: 'attestor-core',
	id: '123',
	type: 'createClaim',
	request: {
		name: 'http',
		...otherParams,
		authRequest: {
			data: {
				userId: 'optional-user-id',
				hostWhitelist: ['api.abcd.xyz']
			},
			signature: {
				type: 'uint8array',
				value: 'base64-encoded-signature'
			}
		}
	}
}))
```

## Deploying to the Cloud

You can deploy your own Reclaim server via the [docker-compose](/prod.docker-compose.yaml). The Reclaim server is a stateless machine so you can scale it horizontally as much as you want.

With the docker compose up:
- Expose the Reclaim HTTP server behind a reverse proxy (like nginx) to the internet.
- Add HTTPS to the reverse proxy to ensure secure communication.
- Since Reclaim uses a websocket, ensure that the reverse proxy is configured to handle websockets.

Your final RPC URL should look something like `wss://<your-domain>/ws`. 

To check the use your server on a mobile device via browser RPC, you can load the page at: `https://<your-domain>/browser-rpc`. It should print out "Attestor Core RPC" on the page.

Once you have your server running, you can use it to generate claims. 
- If using the browser RPC, you can follow the steps mentioned in the [docs](/docs/browser-rpc.md) -- just replace the Reclaim attestor URL with your own.
- If using NodeJS or running in the browser directly, see [this section](/docs/getting-started.md#Code). Just replace the official Reclaim attestor URL with your own.