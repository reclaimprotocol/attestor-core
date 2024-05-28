
# Provider

A "provider" in reclaim's context is simply a set of functions that tells the witness how to format the request & check the validity of the response, that proves a claim.

For example, you could have a provider termed "google-login" that is configured to verify claims of ownership of google accounts.

The library makes it fairly simple to add new providers for particular use cases. Here is how you can add your own:

1. Any new provider must conform to the `Provider` interface
   ```ts
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
		Params extends { [_: string]: unknown },
		SecretParams
	> {
		/**
		* host:port to connect to for this provider;
		* the protocol establishes a connection to the first one
		* when a request is received from a user.
		*
		* Run on witness side when creating a new session
		*
		* Eg. "www.google.com:443", (p) => p.url.host
		* */
		hostPort: ProviderField<Params, string>
		/**
		* Which geo location to send the request from
		* Provide 2 letter country code, or a function
		* that returns the country code
		* @example "US", "IN"
		*/
		geoLocation?: ProviderField<Params, string | undefined>
		/**
		 * extra options to pass to the client like root CA certificates
		 */
		additionalClientOptions?: TLSConnectionOptions
		/**
		* default redaction mode to use. If not specified,
		* the default is 'key-update'.
		*
		* It's switched to 'zk' for TLS1.2 requests as TLS1.2
		* don't support key updates
		*
		* @default 'key-update'
		*/
		writeRedactionMode?: ProviderField<Params, RedactionMode | undefined>
		/**
		* check the parameters are valid
		* Run client & witness side, to verify the parameters
		* are valid
		* */
		areValidParams(params: { [_: string]: unknown }): params is Params
		/** generate the raw request to be sent to through the TLS receipt */
		createRequest(
			secretParams: SecretParams,
			params: Params
		): CreateRequestResult
		/**
		* Return the slices of the response to redact
		* Eg. if the response is "hello my secret is xyz",
		* and you want to redact "xyz", you would return
		* [{start: 17, end: 20}]
		*
		* This is run on the client side, to selct which portions of
		* the server response to send to the witness
		* */
		getResponseRedactions?(response: Uint8Array, params: Params): ArraySlice[]
		/**
		* verify a generated TLS receipt against given parameters
		* to ensure the receipt does contain the claims the
		* user is claiming to have
		*
		* This is run on the witness side.
		* @param receipt application data messages exchanged in the TLS session
		* @param params the parameters to verify the receipt against. Eg. `{"email": "abcd@gmail.com"}`
		* */
		assertValidProviderReceipt(
			receipt: Transcript<Uint8Array>,
			params: Params
		): void | Promise<void> | { extractedParams: { [key: string]: string } }
	}
   ```
2. Should default export the newly constructed provider
3. Should kebab case the file name & store it in `src/providers/{app-name}.ts`
4. Finally, export this new application from `src/providers/index.ts`

Example providers:
- [HTTP](/src/providers/http-provider/index.ts)
	- This is a generic provider that can be used to verify any HTTP request

## HTTP Provider

## Testing a Provider with a Remote Witness

We'd of course recommend writing automated tests for your provider. Examples of such tests can be found in the [tests folder](/src/tests).
However, if you'd like to test your provider with a remote witness, you can do so by following these steps:

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
   npm run generate:receipt -- --json google-login-params.json --witness ws://localhost:8080/ws
   ```
3. The script will output the receipt alongside whether the receipt contained a valid claim from the provider

## Considerations & tests

It's crucial to process `redactions` correctly when creating a request.
Make sure & double check that PII data like oauth tokens & passwords are processed correctly.

Each application should have test in `tests` folder. `redactions` and `assertValidApplicationReceipt` should be the first things to test
