# Claim Creation

This document describes the complete flow for creating a claim on a single witness.

## Intro

First a recap: Reclaim works by having a witness sit between the user & the internet. The user sends data to the internet via the witness. The witness signs this data & sends it back to the user. The user can then use this signed data to prove the claim to anyone. The protocol facilitates the redaction of sensitive information from the data sent to the witness as well using some TLS magic & zero-knowledge proofs. We'll go into the details of this later in the document.

Now, all the communication between the user & the witness is done via protobuf messages over a WebSocket connection. The full details of the protocol can be found in the [RPC protocol docs](/docs/rpc.md).

## What is a Claim?

A claim is a structured piece of data, when signed by the witness, acts as a proof that the user has accessed a particular resource on the internet.

For eg. you have 10,000 USD in your bank account, or you have access to a particular email address, or even that you have access to a Slack organization. These are all claims that can be made using the Reclaim protocol.

A claim looks like this in the protobuf:
``` protobuf
message ProviderClaimData {
	/**
	 * Name of the provider to generate the
	 * claim using.
	 * @example "http"
	 */
	string provider = 1;
	/**
	 * Canonically JSON stringified parameters
	 * of the claim, as specified by the provider.
	 * @example '{"url":"https://example.com","method":"GET"}'
	 */
	string parameters = 2;
	/**
	 * Owner of the claim. Must be the public key/address
	 * @example "0x1234..."
	 */
	string owner = 3;
	/**
	 * Unix timestamp in seconds of the claim being made.
	 * Cannot be more than 10 minutes in the past or future
	 */
	uint32 timestampS = 4;
	/**
	 * Any additional data you want to store with the claim.
	 * Also expected to be a canonical JSON string.
	 */
	string context = 6;
	/**
	 * identifier of the claim;
	 * Hash of (provider, parameters, context)
	 */
	string identifier = 8;
	/**
	 * Legacy V1 Beacon epoch number
	 */
	uint32 epoch = 9;
}
```

The witness only signs the claim "identifier", owner, timestamp & epoch. This permits the verification of the claim without revealing PII to the verifier that may be present in the claim parameters.

## Claim Creation Flow

Let's assume a witness is running at some URL & the user wants to create a claim on it.

Before we begin -- at any point in the flow, either the user or the witness can terminate the connection. This is done by sending an RPC message with the `connectionTerminationAlert` field set.

Also note: in the implementation -- when we refer to any `x` message, we're referring to the protobuf RPCMessage with the `x` field set. For example, `initRequest` refers to the RPCMessage with the `initRequest` field set.

This entire process is facilitated by the [createClaimOnWitness](/src/create-claim/create-claim-on-witness.ts) function. You must pass the following to this function:
- the URL of the witness, or a witness client (see [this section](/docs/rpc.md#implementation))
- provider name, parameters
- optional context to be signed by the witness

1. The user will first connect to the witness, and initialise the connection using the `initRequest` message.
	- This message is a simple communication of metadata about the version the client is running & the signature scheme it supports.
	- The witness will respond with an `initResponse` message -- letting the client know that the connection has been successfully established.
	- If initialisation fails for any reason, the witness will send a `connectionTerminationAlert` message & close the connection.
2. Upon successful initialisation, the user must create a "tunnel" to the end server via the witness.
	- A tunnel is a TCP socket to the end server established on the witness. The witness shall log each packet sent & received over this tunnel. The user can send data to the end server, and receive messages from it via this tunnel.
	- The tunnel is established by sending a `createTunnelRequest` message to the witness. This message contains the host, port of the end server & optionally, the geo-location of the country to connect via. More details on this in the [Geo Location](#geo-location) section.
	- If the witness manages to successfully establish the tunnel, it will respond with a `createTunnelResponse` message.
	- Now, the user can send & receive data to the end server via the witness. Each message belonging to a tunnel is wrapped in a `tunnelMessage` message. This message contains the tunnel ID & the data to send or the data received.
	- The user can send data to the end server by sending a `tunnelMessage` message to the witness, and similarly, the witness will send a `tunnelMessage` message to the user when it receives data from the end server.
	- The user can close the tunnel at any time by sending a `disconnectTunnelRequest` message to the witness optionally with a reason for closing the tunnel.
	- If the end server closes the connection, the witness will send a `tunnelDisconnectEvent` message to the user.
	- Once the user is done with the tunnel, i.e the user has sent all the data they want to the end server & received all the data they want from the end server, they can close the tunnel. After which they can proceed to "claim" the tunnel & prove a claim about the data sent & received over the tunnel. This is done via the `claimTunnelRequest` message.
4. The user will make execute the TLS handshake with the end server via the tunnel through the witness.
	- We utilise our own TLS implementation to manage the TLS connection. More details [here](#tls-implementation).
	- The user manages this connection using the [makeRpcTlsTunnel](/src/tunnels/make-rpc-tls-tunnel.ts) fn.
	- The RpcTlsTunnel also stores all the messages sent & received over the tunnel including the symmetric keys used to encrypt/decrypt the messages. 
		- These will be used later to prove to the witness that the data received from the end server is the same as the data sent to it
	- Note: TLS is secure even when when passing data through the witness & another proxy. The user can send sensitive data to the end server without worrying about the witness snooping on it.
5. Once the TLS handshake is complete, the user can start sending data to the end server. We call upon the provider's `createRequest` fn for this -- that returns the data to be sent as well as the redactions to make.
6. Now, to be able to redact sensitive information from the data sent to the witness, the user must send the data in a specific way. We have two methods to handle this:
	- Using the TLS Key Update method: This is the most efficient method & is the default method. More details on its security [here](#tls-key-update-method). However, it has a few pitfalls:
		- It only works with TLS 1.3
		- Some poor implementations of TLS 1.3 might not support this feature
		- It only works to redact data sent from the user to the end server. It does not work for data sent from the end server to the user. (More on this later)

		Let's look at how this method works. We'll use the example of accessing the Google People API as mentioned in the [problem statement](/docs/problem-statement.md).
		``` http
		GET /v1/people/me?personFields=emailAddresses HTTP/1.1
		Host: people.googleapis.com
		Connection: close
		Content-Length: 0
		Authorization: Bearer {secret-token}


		```

		Now, we'd like to redact the `{secret-token}` from the witness. We can do this by sending the data in chunks. The user will send the data in the following chunks:
		1. `GET /v1/people/me?personFields=e ... Authorization: Bearer `
			- encrypted using K1
		2. `TLS Key Update`
			- encrypted using K1
		3. `{secret-token}`
			- encrypted using K2
		4. `TLS Key Update`
			- encrypted using K2
		5. `\r\n\r\n` (end of the HTTP request)
			- encrypted using K3

		Note: K1, K2, K3 are the symmetric keys negotiated during the TLS handshake used to encrypt the messages. The witness only sees the encrypted messages & does not have access to the keys yet.

		Now, when user finally claims the tunnel, the user will only send the keys K1 & K3 to the witness. This permits the witness to decrypt the first & last chunk of the data sent -- thus, the witness can verify the data sent to the end server without ever seeing the `{secret-token}`.

		Here's a snippet of how this is done in the `createClaimOnWitness` function:

		``` ts
		/**
		 * Write data to the tunnel, with the option to mark the packet
		* as revealable to the witness or not
		*/
		async function writeWithReveal(data: Uint8Array, reveal: boolean) {
			// if the reveal state has changed, update the traffic keys
			// to not accidentally reveal a packet not meant to be revealed
			// and vice versa
			if(reveal !== lastMsgRevealed) {
				await tunnel.tls.updateTrafficKeys()
			}

			await tunnel.write(data)
			// now we mark the packet to be revealed to the witness
			setRevealOfLastSentBlock(reveal ? { type: 'complete' } : undefined)
			lastMsgRevealed = reveal
		}
		```
	- Using the ZKP method: This is the most powerful method, works with all versions of TLS, and also works on both the request and response side of things. However, it is orders of magnitude slower than the TLS Key Update method. Our ZK circuits can be found [here](https://gitlab.reclaimprotocol.org/reclaim/zk-symmetric-crypto).
7. Once the user has sent all the data they want to the end server, they shall wait for the response to complete. Once the response is complete, the user can close the tunnel & proceed to claim the tunnel. We utilise our own [HTTP response parser](src/utils/http-parser.ts) to parse the response & find the end of the response.
8. Now that we have all the data sent & received over the tunnel, we can proceed to claim the tunnel. Before we do this, we must prepare the transcript of the data sent & received over the tunnel. This is done using the `generateTranscript` function.
	- The first step is to find out which portions of the data received from the end server are to be revealed to the witness. This is done by the provider's `getResponseRedactions` function, which returns the indices of the data to be redacted.
		- In the absence of this function, the entire response is revealed to the witness via a direct reveal.
	- The transcript is a list of each message sent & received over the tunnel, with optionally data for the witness to see the plaintext of the message.
	``` protobuf
	message TranscriptMessage {
		/** client or server */
		TranscriptMessageSenderType sender = 1;
		/** packet data */
		bytes message = 2;
		MessageReveal reveal = 3;
	}

	message MessageReveal {
		oneof reveal {
			// direct reveal of the block via the key & IV
			// cipher (aes, chacha) for decryption
			// selected based on `cipherSuite`
			// determined by the server hello packet
			MessageRevealDirect directReveal = 1;
			// partially or fully reveal the block via a zk proof
			MessageRevealZk zkReveal = 2;
		}
	}
	```


## Appendix

### Signing and Verifying a Claim

The claim before being signed is serialised using the following function:
``` ts
/**
 * Creates the standard string to sign for a claim.
 * This data is what the witness will sign when it successfully
 * verifies a claim.
 */
export function createSignDataForClaim(data: CompleteClaimData) {
	const identifier = 'identifier' in data
		? data.identifier
		: getIdentifierFromClaimInfo(data)
	const lines = [
		identifier,
		// we lowercase the owner to ensure that the
		// ETH addresses always serialize the same way
		data.owner.toLowerCase(),
		data.timestampS.toString(),
		data.epoch.toString(),
	]

	return lines.join('\n')
}
```

We chose those simple stringified format for the claim to be signed to make it easy to verify the claim from multiple languages & platforms. The witness will then sign this string & send it back to the user.

In the SDK, you can verify the claim using the `assertValidClaimSignatures` function. This function will verify the claim, the signature of the claim, the signature of the witness & the transcript of the claim.

The above two functions are implemented [here](/src/utils/claims.ts).

### Geo Location

A witness can be configured to allow connections from certain countries. This is done by setting the `geoLocation` field in the `CreateTunnelRequest` message to the 2 letter ISO country code of the country you want to connect from.

Implementation of this is done using an HTTPS proxy, which lets us connect to an end server & gives us an opaque connection to the end server. Reclaim's own witness server has this feature built in & is powered via [Bright Data](https://brightdata.com/).

The particular HTTPS proxy to use is specified in the witness's env file. Refer to the [env file](/.env.sample) for more details.

This feature is useful for connecting to end servers that might block connections from certain countries.

Do keep in mind, you do not have to trust the proxy server nor the witness with any sensitive data. Using [TLS certifcate pinning](https://www.ssl.com/blogs/what-is-certificate-pinning/), the user ensures that the connection is secure with & the data is not tampered with.

### TLS Implementation

You can find our TLS implementation [here](https://gitlab.reclaimprotocol.org/reclaim/tls). We wrote a custom implementation for a few reasons:
- We needed to extract the precise symmetric keys used to encrypt each message. This is necessary for us to either:
	- send the precise keys to the witness so it can decrypt the messages & verify the content inside
	- or to pass the keys to our ZKP circuit to create a proof that the witness can verify the plaintext of the message without needing the keys.
- We required a pure JavaScript implementation of TLS to run in the browser. 

As we couldn't find any existing libraries that met our requirements, we wrote our own. The library is compatible with NodeJS & the browser & implements both TLS 1.2 & 1.3.

### TLS Key Update Method

The key update method was introduced in TLS 1.3 & is a feature that allows the client to update the symmetric keys used to encrypt/decrypt messages without having to re-establish the connection nor send the new keys over the wire.
This is done by sending a `KeyUpdate` message in the TLS handshake. In our implementation, this is done by calling the `updateTrafficKeys` method.

Let's look at how this method works:
1. During the handshake, the client & server perform the [Diffie-Hellman key exchange](https://en.wikipedia.org/wiki/Diffie–Hellman_key_exchange), and use that to arrive at a shared master secret. We'll call this `M`
	- Do keep in mind, the witness nor any other party have access to this master secret. They only see the encrypted messages.
	- This security is provided by the Diffie-Hellman key exchange.
2. The client & server use `M` to derive the symmetric keys used to encrypt/decrypt messages. Simplifying, assume these are `K1 = H(M)` where `H` is a hash function.
	- The hash function is a one-way function. Given `K1`, it is infeasible to find `M`.
	- The client & server use `K1` to encrypt/decrypt messages. For eg. `C = E(K1, P)` where `C` is the ciphertext & `P` is the plaintext.
3. The client can send a `KeyUpdate` message to the server. This is essentially an empty message that signals to the server that the client is updating the keys. This message does not contain the new keys.
4. Instead, the client & server:
	- Derive a new master secret `M'` from `M`, using a set of rules defined in the TLS spec. This is essentially `M' = H(M)`, so it's infeasible to find `M` given `M'`.
	- Derive a new set of symmetric keys `K2 = H(M')` from `M'`.
	- The client & server now use `K2` to encrypt/decrypt messages.
5. Note: one can publish `K1` to the witness, and so it can decrypt the messages using `K1`. However, the witness cannot decrypt messages encrypted with `K2` as it does not have access to `M'`.