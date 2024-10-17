# Working with the Project

## Folder Structure

- `src`: Contains the source code for the attestor server.
	- `server`: Code to run a attestor server. Code here runs entirely on the server, importing code from here in a browser environment will not work.
	- `client`: Contains the client code. This code is run on a client interacting with the attestor server.
	- `avs`: Contains the code for the Eigen AVS used to decentralize the Reclaim protocol.
		- `client`: Contains code to create claims via the AVS.
	- `window-rpc`: Contains code to setup a listener on the browser for a mobile app to interact with the SDK. More on this in the [docs](docs/browser-rpc.md). Entirely client-side code.
	- `...`: Other common code & utils used by both the client & server.
- `avs`: Smart contracts & respective code, utils for the Eigen AVS.
- `proto`: Protobuf spec for client-server communication.