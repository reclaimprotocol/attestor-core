# Reclaim Witness SDK

SDK for creating claims & verifying them using a Reclaim Witness server.

## Install

The SDK is compatible with the browser & NodeJS.
To run the SDK on React Native/Mobile, keep reading.

### Installing in a project

`npm install git+https://github.com/reclaimprotocol/witness-sdk`

**Note:** this approach is only advised for NodeJS projects or projects meant to run directly in a modern browser. For React Native or any solution running in a mobile app, keep reading.

## Usage

Example of creating a claim:

```ts
import { createClaim } from '@reclaimprotocol/reclaim-node'

const {
// data describing the minted credential
claimData,
// signatures returned by oracles
signatures,
} = await createClaim({
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
})
```

## React Native / Mobile

In order to run on React Native, you'll need to run the witness SDK in a WebView & communicate with it via postMessage.

Generally, this is a painful process -- but we've tried our best to make this easy for ya'll. We host the SDK with preconfigured code for you to RPC with. This is available on `https://sdk-rpc.reclaimprotocol.org`

To use this, you'll need to:
1. Install the `react-native-webview` package in your project
2. Create a WebView in your app:
	``` tsx
	function RenderWebView() {
		return (
			<WebView
				ref={(r) => (webviewRef.current = r)}
				originWhitelist={['*']}
				javaScriptEnabled={true}
				source='https://sdk-rpc.reclaimprotocol.org'
				onMessage={(data) => {
					const rpcRes = data.nativeEvent.data
					// will be a JSON string
					console.log('got res', rpcRes)
				}}
			/>
		)
	}
	```
3. postMessage to createClaim:
	```ts
	const req = {
		// lets the window know this is a request
		// intended for it
		module: 'witness-sdk',
		// this is a random ID you generate,
		// use to match the response to the request
		id: '123',
		// the type of request you want to make
		type: 'createClaim',
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
		}
	}
	webviewRef.current?.postMessage(
		JSON.stringify(req),
	)
	```

## Provider

An "provider" in reclaim's context is simply a provider for some reputation or credential.

For example, you could have a provider termed "google-login" that is configured to verify claims of ownership of google accounts. (PS: this has actually been implemented here)

The library makes it fairly simple to add new providers for particular use cases. Here is how you can add your own:

1. Any new provider must conform to the `Provider` interface
   ```ts
	/**
	* Generic interface for a provider that can be used to verify
	* claims on a TLS receipt
	* @notice "Params" are the parameters you want to claim against.
	* These would typically be found in the response body
	* @notice "SecretParams" are the parameters that are used to make the API request.
	* These must be redacted in the request construction in "createRequest" & cannot be viewed by anyone
	*/
	export interface Provider<Params extends { [_: string]: unknown }, SecretParams> {
		/**
		* host:port pairs considered valid for this provider;
		* the protocol establishes a connection to the first one
		* when a request is received from a user
		* Eg. ["www.google.com:443"]
		* */
		hostPort: string | ((params: Params) => string)

		/** extra options to pass to the client like root CA certificates */
		additionalClientOptions?: TLSConnectionOptions
		/** check the parameters are valid */
		areValidParams(params: { [_: string]: unknown }): params is Params
		/** generate the raw request to be sent to through the TLS receipt */
		createRequest(secretParams: SecretParams, params: Params): CreateRequestResult
		/**
		* Return the slices of the response to redact
		* Eg. if the response is "hello my secret is xyz",
		* and you want to redact "xyz", you would return
		* [{start: 17, end: 20}]
		* */
		getResponseRedactions?(response: Uint8Array, params: Params): ArraySlice[]
		/**
		* verify a generated TLS receipt against given parameters
		* to ensure the receipt does contain the claims the
		* user is claiming to have
		* @param receipt the TLS receipt to verify
		* @param params the parameters to verify the receipt against. Eg. `{"email": "abcd@gmail.com"}`
		* */
		assertValidProviderReceipt(receipt: TLSReceipt, params: Params): void | Promise<void>
	}
   ```
2. Should default export the newly constructed provider
3. Should kebab case the file name & store it in `src/providers/{app-name}.ts`
4. Finally, export this new application from `src/providers/index.ts`

Example providers:
- [HTTP](/src/providers/http-provider/index.ts)
	- This is a generic provider that can be used to verify any HTTP request
- [Google Login](/src/providers/google-login.ts)

### Testing a Provider with a Witness

1. Create a JSON outlining the parameters for the provider. For eg. for the HTTP provider, this would look like:
   ```json
   {
   	"name": "google-login",
   	"params": {
   		"emailAddress": "abcd@gmail.com"
   	},
   	"secretParams": {
   		"token": "{{GOOGLE_ACCESS_TOKEN}}"
   	}
   }
   ```
   - Note any parameters specified by `{{*}}` will be replaced by the value of the environment variable with the same name. By default, the script will look for a `.env` file
2. Run the receipt generation script with the JSON as input.
   ```sh
   npm run generate:receipt -- --json google-login-params.json
   ```
   This will use the default witness server to generate a receipt for the given provider. To use a custom witness server, use the `--witness` flag
   ```sh
   npm run generate:receipt -- --json google-login-params.json --witness http://localhost:8080
   ```
3. The script will output the receipt alongside whether the receipt contained a valid claim from the provider
4. Examples of such JSONs can be found in the `example` folder

## Considerations & tests

It's crucial to process `redactions` correctly when creating a request.
Make sure & double check that PII data like oauth tokens & passwords are processed correctly.

Each application should have test in `tests` folder. `redactions` and `assertValidApplicationReceipt` should be the first things to test

## Troubleshooting

### Common Errors

#### "Root CA not found. Could not verify certificate"

This means that the root CA for the domain you're trying to connect to has not been added to the reclaim witness. We have the Mozilla root CA list by default, but if this error occurs, you'll need to add the root CA for the domain you're trying to connect to.

To add a root CA, follow these steps:

1. If you don't know what a root CA is, read [this](https://comodosslstore.com/resources/what-is-a-root-ca-certificate-and-how-do-i-download-it/)
2. Run `npm run verify:root-ca {host}`
	- `{host}` is the host you're trying to connect to, which results in the error
	- At the end of the script, you'll see a log like:
		``` json
		{"level":30,"time":1686473965567,"pid":8408,"hostname":"192.168.1.10","err":"Root CA not found. Could not verify certificate","rootIssuer":{"attributes":[{"type":"2.5.4.10","value":"Digital Signature Trust Co.","valueTagClass":19,"name":"organizationName","shortName":"O"},{"type":"2.5.4.3","value":"DST Root CA X3","valueTagClass":19,"name":"commonName","shortName":"CN"}],"hash":"6ff4684d4312d24862819cc02b3d472c1d8a2fa6"},"msg":"error in cert verify"}
		```
	- Copy the `commonName` object from the log (`DST Root CA X3` in the above log). This is the name of the root CA.
3. Find the root CA certificate online using the name you copied
	- http://www.certificate.fyicenter.com/ is a good resource
4. Copy the certificate in PEM format
5. Add the certificate to your provider:
	``` ts

	```
6. Run `npm run verify:root-ca {host}`. This time, it should succeed & you won't see an error at the bottom of the log
		

	