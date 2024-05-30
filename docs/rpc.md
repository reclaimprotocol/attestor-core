# Reclaim RPC Protocol

We utilise a custom RPC protocol for Reclaim written on top of protobuf. We execute this protocol over a WebSocket.

You can find the protobuf definition [here](/proto/api.proto).

## Why protobuf?

Protobuf is a binary serialization format that is both faster & more efficient than JSON. Plus, it is type-safe by design. This is super helpful, as the protocol deals with a lot of binary data like TLS packets & cryptographic signatures.

### If protobuf, why not gRPC?

gRPC is great for internal services, but setting it up for the web especially via WebSockets is a pain.

The protocol we have is in essence gRPC with a few minor tweaks for our use case. 

## Why a WebSocket?

1. Well, we get bi-directional streaming for free. This is super useful for tunnels as we can send data in both directions. (Bidirectional streaming isn't well supported on gRPC-web)
2. We can multiplex multiple streams over a single socket if needed.
3. Another big reason is we get horizontal scaling for free.
	- The nature of the protocol is such that we need to consistently send & receive data from the same server.
	- If we were to use HTTP/2 or some other REST-like mechansim, we'd have to implement some sort of sticky session mechanism to ensure that the client always connects to the same server.
	- This isn't required with WebSockets, as once a connection is established, it stays connected to the same server until it's closed.
4. Of course -- instead of a WebSocket, it's possible to use any other transport like QUIC or HTTP/2 or even a regular TCP socket, but since WebSockets are widely supported on the web, we chose the same.

## Protocol

The protocol is defined in the `proto/api.proto` file. Each message in the RPC protocol is defined in a single protobuf message:

```protobuf
message RPCMessage {
	/**
	 * Per connection unique RPC message ID. Either party sending a
	 * duplicate ID will do nothing except confuse the other party.
	 *
	 * For response messages, the ID should be the same as the request
	 * to which it is responding.
	 */
	uint64 id = 1;
	// message must be one of the following
	oneof message {
		InitRequest initRequest = 1;
		Empty initResponse = 2;
		/**
		 * Data representing an error in the WebSocket connection.
		 * The party sending this message should close the connection
		 * immediately after sending this message.
		 */
		WitnessErrorData connectionTerminationAlert = 3;
		/**
		 * Data representing an error in the witness's
		 * request to the server. This should be sent in case
		 * there was an error in processing the request.
		 */
		WitnessErrorData requestError = 5;
		/**
		 * Using the transcript of a tunnel, make a claim.
		 * The tunnel must be disconnected before making a claim.
		 */
		ClaimTunnelRequest claimTunnelRequest = 11;
		ClaimTunnelResponse claimTunnelResponse = 12;
		/** Other RPCs ... */
	}
}

message RPCMessages {
	repeated RPCMessage messages = 1;
}
```

In practise, we use `RPCMessages` to send multiple messages in a single packet. This is super useful in helping reduce the number of round trips, as we can stack many requests in a single packet.

Let's look at an example flow:

1. Client prepares the `InitRequest` message (which contains metadata about the witness version & signature scheme), and serialises in an `RPCMessages` packet.
2. The aforementioned packet is then sent to the server initially with the WebSocket connection request in the query parameter. So, now our URL looks like `wss://server.com/ws?messages=<base64 encoded RPCMessages packet>`.
	- Note: the `messages` query parameter is optional & can contain multiple messages. The advantage of this is that we can not only initialise the connection but also create a tunnel & send a TLS packet in the same request that establishes the connection. Thus, helping reduce multiple round trips to just 1.
2. Now, the server parses the `messages` query parameter & validates it:
	- If successful, it sends an `initResponse` message back to the client.
	- Note: If the messages passed in the `messages` query param failed to process. The server shall send a `connectionTerminationAlert` message back to the client & close the connection.

## Implementation

The implementation is broken down into 3 layered parts:
1. [WitnessSocket](src/client/socket.ts): this is the base class that handles basic functions required on the client & server side -- such as sending & receiving messages, handling errors, etc.
2. [WitnessClient](src/client/index.ts): this is the client implementation that extends `WitnessSocket` & adds functions to make RPC calls among other things.
3. [`WitnessServerSocket`](src/server/socket.ts): this is the implementation of a client connected on the server side. It extends `WitnessSocket` and adds functions to store & manage tunnels created by the client.

### Creating a Client

``` ts
import { WitnessClient } from '@reclaimprotocol/witness-sdk'

const client = new WitnessClient({
	url: 'wss://server.com/ws',
})
// wait for the connection to be successfully established
await client.waitForInit()
// now you can make RPC calls
await client.rpc('createTunnel', {
	host: 'example.com',
	port: 443,
})
```

1. At any point, the client or server can terminate the connection. This is done by sending an RPC message with the `connectionTerminationAlert` field set. 
	- In such an event, all pending RPC calls will be rejected with the error message provided in the `connectionTerminationAlert` message
2. Any error in executing an RPC call will be sent back to the client with the `requestError` field set. The ID of this message will be the same as the request message.

### Available events

Of course, the client emits events that you can listen to. These are laid out [here](src/types/rpc.ts?ref_type=heads#L33) & are fully typed up.

``` ts
// connection terminated event
client.addEventListener('connection-terminated', (err) => {
	console.error('error', err)
})
// you can also terminate the connection yourself
// and optionally provide a reason
client.terminateConnection(new Error('some reason'))

// listen to messages on the tunnel
client.addEventListener('tunnel-message', ({ data }) => {
	console.log('recv msg on tunnel: ', data.tunnelId, data.data)
})

// ...
```

### Adding a new RPC Method

1. add the request & response messages to `proto/api.proto` & then add them to the `RPCMessage` message. For eg.
   ```protobuf
   message AbcdRequest {
	   ...
   }
   message AbcdResponse {
	   ...
   }

   message RPCMessage {
	   ...
	   oneof message {
		   ...
		   AbcdRequest abcdRequest = 13;
		   AbcdResponse abcdResponse = 14;
	   }
   }
   ```

   Note: if the RPC is `abcd`:
	- The request message should be named `AbcdRequest` (pascal case)
	- The response message should be named `AbcdResponse` (pascal case)
	- The oneof field should be named `abcdRequest` & `abcdResponse` (camel case)
2. Implement the handler for this RPC in the `src/v2/server/handlers` folder. Name the file `abcd.ts` and export the handler as `abcd`. (Of course, abcd should be replaced with the actual name of the RPC)
	``` ts
	export const abcd: RPCHandler<'abcd'> = async(
		{ },
		// context to help with logging & other things
		{ client, logger }
	) => {
		// throw errors here too if required, they'll be correctly
		// serialized & sent back to the client
		// if all goes well, return the response (AbcdResponse)
		return {}
	}
	```
3. Add handler to the `HANDLERS` object in `src/v2/server/handlers/index.ts`:
	```ts
	import { abcd } from './abcd'
	export const HANDLERS = {
		...
		abcd,
		...
	}
	```
4. You can now call this RPC from the client using the `WitnessClient` class. For eg.
	```ts
	const response = await client.rpc('abcd', { ... })
	```