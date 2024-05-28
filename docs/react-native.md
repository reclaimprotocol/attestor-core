# Reclaim on React Native

In order to run on React Native, you'll need to run the witness SDK in a WebView & communicate with it via postMessage.

Generally, this is a painful process -- but we've tried our best to make this easy for ya'll. We host the SDK with preconfigured code for you to RPC with.

This is available on `https://witness.reclaimprotocol.org/browser-rpc`

## Setup

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
	webviewRef.current?.postMessage(JSON.stringify(req))
	```

## Running the Browser SDK Locally

1. Build the SDK for the browser using `npm run build:browser`
	- If making changes & you want to see changes live, run `npm exec webpack -- --watch`
2. Run the API & browser server using `npm run start:tsc`
