
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
		* @returns sucessful verification or throws an error message.
		*  Optionally return parameters extracted from the receipt
		*  that will then be included in the claim context
		* */
		assertValidProviderReceipt(
			receipt: Transcript<Uint8Array>,
			params: Params
		): void | Promise<void> | { extractedParams: { [key: string]: string } }
	}
   ```

   Note: a "ProviderField" is either a constant value of the field or a function that returns the field value from the parameters passed to the provider.
2. Should default export the newly constructed provider
3. Should kebab case the file name & store it in `src/providers/{app-name}.ts`
4. Finally, export this new application from `src/providers/index.ts`

Example providers:
- [HTTP](/src/providers/http-provider/index.ts)
	- This is a generic provider that can be used to verify any HTTP request

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

## HTTP Provider

Since almost all APIs we'd encounter would be HTTP based, we've created a generic HTTP provider that can be used to verify any HTTP request.

All you need to do is provide the URL, method, headers & body of the request you want to verify along with the secret parameters required to make the request (that are hidden from the witness any other party).

Let's look at a detailed example of how to prove the date of birth of a user without revealing any other information. We'd be doing this via the "Aadhar" API. For context, Aadhar is a unique identification number issued by the Indian government to its citizens.

The parameters of the request would be:
``` json
{
    "name": "http",
    "params": {
		// specifies the API/webpage URL that contains the date of birth
		// or the data you want to prove
        "url": "https://tathya.uidai.gov.in/ssupService/api/demographics/request/v4/profile",
		// http method
        "method": "POST",
		// the body of the request -- we've included a "template" here
		// that will be replaced by the actual UID number. Templates in
		// the http provider are mustache templates.
		// https://mustache.github.io/
        "body": "{\"uidNumber\":\"{{uid}}\"}",
		// optionally, we've specified which country the request should be
		// sent from. This is useful when the API you're hitting is geo
		// restricted
        "geoLocation": "IN",
		// this is the response redaction. This tells our client
		// what portions of the data are relevant to the claim
		// we're trying to prove. The client will slice the response
		// in such a way that only the portions specified here are
		// sent to the witness. This redaction can be done via
		// JSONPath, XPath or regex. If all are specified, the witness will
		// first find the element matching the xpath -> then use the JSONPath
		// to find the specific data & finally use the regex to match the data
        "responseRedactions": [
            {
				// json path for date of birth
                "jsonPath": "$.responseData.dob",
                "xPath": "",
            }
        ],
		// this is the response selection. This tells the witness
		// what to look for in the response. If the response doesn't
		// match this -- the witness will reject the claim.
		// This selection can be done either by a simple string match
		// or regex
		"responseSelections": [
			{
				"type": "regex",
				"value": "(?<dob>\\d{4}-\\d{2}-\\d{2})"
			}
		],
		// headers to be sent with the request that help access
		// the API/webpage. The headers present in the "params"
		// are meant to be public & can be viewed by anyone -- 
		// including the witness
		"headers": {
			"accept": "application/json, text/plain, */*",
            "accept-language": "en_IN",
            "appid": "SSUP",
            "content-type": "application/json",
		},
		"paramValues": {
			"uid": "123456789012"
		}
    },
	// secret parameters that are used to make the request
	// these are hidden from the witness & any other party
    "secretParams": {
		// the headers present in the "secretParams" are meant to be
		// secret & cannot be viewed by anyone -- including the witness
		// these are redacted by the client before sending the transcript
		// to the witness
        "headers": {
            "x-request-id": "{{requestId}}",
			"Authorization": "Bearer {{bearerToken}}"
        },
		// the paramValues are the values that will replace the templates
		// only in the secretParams. These parameters will of course, not
		// be visible to the witness.
		// To replace the templates in the params, you can place a
		// "paramValues" key in the params object
		"paramValues": {
			"requestId": "1234",
			// bearer token can be found using the network inspector
			// on the Aadhar website
			"bearerToken": "replace-this-with-your-token"
		}
    }
}
```

Now, you may be wondering we've not actually specified the date of birth in the parameters. It's simply a regex that matches any date. So, how does the witness know what date to prove?

This is where "extractedParams" come in. When the witness processes the transcript, it'll use the regex specified in the `responseMatches` to extract the date of birth from the response.

This date of birth will then be included in the `context` property of the claim. It'll be specified by the name of the regex group. In our case that was `dob`. In the absence of a named group -- the parameter will not be extracted. Read more on named regex groups [here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_capturing_group)

Therefore, upon a successful claim -- the claim object will look like:
``` json
{
	"provider": "http",
	"parameters: "{\"url\":\"https://...",
	"context": {
		"extractedParams": {
			"dob": "1999-01-01"
		}
	},
	"owner": "0x1234...",
	...
}
```

And there you have it! You can now use this claim to prove the age of a person without revealing any other information.

You can read the full types of the HTTP provider [here](/src/providers/http-provider/types.ts?ref_type=heads#L55)