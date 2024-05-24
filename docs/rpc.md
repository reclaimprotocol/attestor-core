# Reclaim RPC Protocol

We utilise a custom RPC protocol written on top of protobuf & execute this protocol over a WebSocket.

## Why use protobuf?

Protobuf is a binary serialization format that is both faster & more efficient than JSON. Plus, it is type-safe by design. This is super helpful, as the protocol deals with a lot of binary data like TLS packets & cryptographic signatures.

### If protobuf, why not gRPC?

gRPC is great for internal services, but setting it up for the web especially via WebSockets is a pain.

The protocol we have is in essence gRPC with a few minor tweaks for our use case. 

## Why a WebSocket?

1. Well, we get bi-directional streaming for free. This is super useful for tunnels as we can send data in both directions. (Bidirectional streaming isn't well supported on gRPC-web)
2. We can multiplex multiple streams over a single socket if needed.
3. Instead of a WebSocket, it's possible to use any other transport like QUIC or HTTP/2 or even a regular TCP socket, but since WebSockets are widely supported on the web, we chose it.

## Protocol

The protocol is defined in the `proto/api.proto` file. Each message in the RPC protocol is defined in a single protobuf message:

```protobuf
message ReclaimRPCMessage {
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
		/**
		 * Response to the init request.
		 * The request must be sent in the WebSocket URL
		 * as a query parameter.
		 * `?initRequest=base64(proto(InitRequest))`
		 * */
		Empty initResponse = 2;
		/**
		 * Data representing an error in the WebSocket connection.
		 * The party sending this message should close the connection
		 * immediately after sending this message.
		 */
		WitnessErrorData connectionTerminationAlert = 3;
		/**
		 * Using the transcript of a tunnel, make a claim.
		 * The tunnel must be disconnected before making a claim.
		 */
		ClaimTunnelRequest claimTunnelRequest = 11;
		ClaimTunnelResponse claimTunnelResponse = 12;
		/** Other RPCs ... */
	}
}
```

Let's look at an example flow:

1. Client connects to the WebSocket server via:
   ```ts
   const ws = new WebSocket("wss://some.witness.address?initRequest=base64(proto(InitRequest))")
   ```
2. Server checks the `initRequest` query parameter & validates it:
	- If successful, it sends an `initResponse` message back to the client.
	- If unsuccessful, it sends a `connectionTerminationAlert` message back to the client.
3. Upon receiving the `initResponse` message, the client can start sending RPC messages to the server. For eg. they could create a tunnel via `createTunnelRequest`

Utility functions to help the WebSocket client & server encode & decode these messages are provided in `src/v2/utils/extend-ws.ts`.