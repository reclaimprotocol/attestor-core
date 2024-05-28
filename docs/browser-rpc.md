# Browser RPC

Platforms like React Native don't have all the capabilities of a browser that are required to run the witness SDK. Namely:
 - Workers
 - DOMParser

In order to run on React Native, Flutter & other platforms that don't have these capabilities, you'll need to run the witness SDK in a WebView & communicate with it via postMessage.

Generally, this is a painful process -- but we've tried our best to make this easy for ya'll. We host the SDK with preconfigured code for you to RPC with. This browser RPC SDK is hosted automatically on every witness node.

This is available on `https://witness.reclaimprotocol.org/browser-rpc`

## Setup on React Native

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
				onMessage={onMessageImpl}
			/>
		)
	}
	```
3. postMessage to createClaim:
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
	webviewRef.current?.postMessage(JSON.stringify(req))
	```
4. Handle the response from createClaim & optionally the step updates:
	``` ts
	import type { WindowRPCOutgoingMsg } from '@reclaimprotocol/witness-sdk'

	function onMessageHandler(data) {
		const rpcRes: WindowRPCOutgoingMsg = data.nativeEvent.data
		// will be a JSON string
		console.log('got res', rpcRes)
		// response to the createClaim request will have the same ID
		// + the type will be 'createClaimDone' (type of request
		// + 'Done' appended to it)
		if(rpcRes.id === '123' && rpcRes.type === 'createClaimDone') {
			// this is the response to the createClaim request
			// do something with it
			console.log('got createClaim response', rpcRes.response)
		}

		// the witness will send you updates on the claim creation process
		// these will have the type 'createClaimStep'
		if(rpcRes.type === 'createClaimStep') {
			// this is an update on the claim creation process
			// do something with it
			console.log('got createClaim step', rpcRes.step)
		}
	}
	```

## Running the Browser SDK Locally

1. Build the SDK for the browser using `npm run build:browser`
	- If making changes & you want to see changes live, run `npm exec webpack -- --watch`
2. Run the API & browser server using `npm run start:tsc`

## Implementation Details

The full implementation can be accessed [here](/src/window-rpc/)
The SDK is built using the `window.postMessage` API.

The "app" is the React Native app or any other app that wants to interact with the witness. Whereas the "witness" is the witness SDK running in the webview browser environment.

Besides the `createClaim` method, the SDK also exposes other methods that the app can call on the witness. These are:

``` ts
/**
 * Fns the app calls on the witness.
 * These are things done inside the witness
 */
export type WindowRPCClient = {
	/**
	 * Create a claim on the witness where the RPC SDK is hosted.
	 */
	createClaim(options: RPCCreateClaimOptions): Promise<CreateClaimResponse>
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
	 * Set the log level for the witness,
	 * optionally set "sendLogsToApp" to true to send logs
	 * back to the app
	 */
	setLogLevel(options: LogLevelOptions): Promise<void>
}
```

From the above schema, you can see that the app can also set the log level for the witness & optionally send logs back to the app. This is useful to know each step of the claim creation process & debug any issues that might arise.

