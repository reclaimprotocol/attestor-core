# External RPC

To allow the Attestor to be used in non-browser environments with only access to a JS runtime like JavascriptCore or QuickJS, the attestor can be bundled into a single dependency free bundle that can be run in any ES6 compatible environment.

The latest version of this JS bundle is hosted & available at `https://attestor.reclaimprotocol.org:444/browser-rpc/resources/attestor-jsc.min.mjs`.

Communication with the attestor can be done via channels exposed in the native runtime, such as `postMessage` in React Native. We have tests that ensure the attestor can be run in a `javascriptcore` environment using the `jsc` CLI.

## Integrating with a JS Runtime

For flutter, using `flutter_js`:
``` js
import { setupJsRpc } from 'path/to/attestor-jsc.min.mjs'

setupJsRpc('https://attestor.reclaimprotocol.org:444')
```

You can call a method on the attestor like this:
``` js
import { setupJsRpc } from 'path/to/attestor-jsc.min.mjs'

handleIncomingMessage({
	// lets the window know this is a request
	// intended for it
	module: 'attestor-core',
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
			"responseMatches": [
				{
					"type": "regex",
					"value": "{\"id\":111111,.*?waas_admin.*?:{.*?}.*?:{.*?}.*?(?:full_name|first_name).*?}"
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
})
```

Listen for responses to requests (and requests from the attestor) using:
``` dart
javascriptRuntime.onMessage('attestor-core', (args) async {
	// do something
})
```

## Implementation Details

The full implementation can be accessed [here](/src/external-rpc/)

The "app" is the React Native app or any other app that wants to interact with the attestor. Whereas the "attestor" is the attestor-core client running in the webview browser environment.

Besides the `createClaim` method, the SDK also exposes other methods that the app can call on the attestor. These are:

``` ts
/**
 * Fns the app calls on the attestor.
 * These are things done inside the attestor
 */
export type ExternalRPCClient = {
	/**
	 * Create a claim on the attestor where the RPC SDK is hosted.
	 */
	createClaim(options: RPCCreateClaimOptions): Promise<CreateClaimResponse>
	/**
	 * Create a claim on the AVS
	 */
	createClaimOnAvs(opts: RPCCreateClaimOnAvsOptions): Promise<AVSCreateResult>
	/**
	 * Create a claim on Mechain
	 */
	createClaimOnMechain(opts: RPCCreateClaimOnMechainOptions): Promise<MechainCreateResult>
	/**
	 * Extract an HTML element from a string of HTML
	 */
	extractHtmlElement(options: ExtractHTMLElementOptions): Promise<ReturnType<typeof extractHTMLElement>>
	extractJSONValueIndex(options: ExtractJSONValueIndexOptions): Promise<ReturnType<typeof extractJSONValueIndex>>
	getCurrentMemoryUsage(): Promise<{
		available: boolean
		content: string
	}>
	/**
	 * Set the log level for the attestor, optionally set "sendLogsToApp" to 
	 * true to send logs back to the app
	 */
	setLogLevel(options: LogLevelOptions): Promise<void>

	benchmarkZK(): Promise<string>

	ping(): Promise<{ pong: string }>
}
```

From the above schema, you can see that the app can also set the log level for the attestor & optionally send logs back to the app. This is useful to know each step of the claim creation process & debug any issues that might arise.

### Passing Binary Data Back & Forth

The attestor SDK can also pass binary data back & forth between the app & the attestor. This is done by encoding the binary data as base64 strings.

1. The attestor client running in the webview automatically encodes binary data as base64 strings before sending it to the app. 
2. The app can send binary data to the attestor by encoding it as a base64 string & sending it as a string.

Please follow the following spec to send binary data to the attestor:
``` json
{ "some-field": { "type": "uint8array", "value": "base64-data" } }
```

For example: if the data is `{ "some-field": new Uint8Array([1, 2, 3, 4]) }`, the JSON to send to the attestor would be:
``` json
{ "some-field": { "type": "uint8array", "value": "AQIDBA==" } }
```

Refer to [this](/src/utils/b64-json.ts) for the implementation of binary data encoding & decoding. You can use this in your app to encode & decode binary data.
``` ts 
import { B64_JSON_REPLACER } from '@reclaimprotocol/attestor-core'
const str = JSON.stringify(
	{ "some-field": new Uint8Array([1, 2, 3, 4]) },
	B64_JSON_REPLACER
)
```

### Testing

To test the attestor on javascriptcore:
1. Ensure you have the `jsc` CLI installed. You can check it's availability by running `jsc --version`. On a Mac, see [this guide](https://seasidetesting.com/2021/07/10/conveniently-start-a-javascript-shell-jsc-on-macos/) to enable it.
2. Build the `jsc` test bundle:
``` bash
npm run run:tsc -- src/scripts/build-jsc.ts --cli
```
3. Run the tests:
``` bash
npm run run:test-files -- src/tests/jsc.test_mac.ts
```