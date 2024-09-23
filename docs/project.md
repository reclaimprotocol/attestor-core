# Working with the Project

## Folder Structure

- `src`: Contains the source code for the witness server.
	- `server`: Code to run a witness server. Code here runs entirely on the server, importing code from here in a browser environment will not work.
	- `client`: Contains the client code. This code is run on a client interacting with the witness server.
	- `avs`: Contains the code for the Eigen AVS used to decentralize the Reclaim protocol.
		- `client`: Contains code to create claims via the AVS.
	- `window-rpc`: Contains code to setup a listener on the browser for a mobile app to interact with the SDK. More on this in the [docs](docs/browser-rpc.md). Entirely client-side code.
	- `...`: Other common code & utils used by both the client & server.
- `avs`: Smart contracts & respective code, utils for the Eigen AVS.
- `proto`: Protobuf spec for client-server communication.


## Running a Witness Locally

1. Of course, clone this repository.
2. Ensure you have an env file with at least the `PRIVATE_KEY` set. See the [.env.sample](.env.sample) file to see all available options.
3. Optional: build the browser RPC files with `npm run build:browser`. More on this in the [docs](docs/browser-rpc.md).
4. Run the witness server with `npm run start:tsc`. This will start the server on port 8001 by default.

## Deploying to the Cloud

You can deploy your own Reclaim server via the [docker-compose](/docker-compose.yaml). The Reclaim server is a stateless machine so you can scale it horizontally as much as you want.

With the docker compose up:
- Expose the Reclaim HTTP server behind a reverse proxy (like nginx) to the internet.
- Add HTTPS to the reverse proxy to ensure secure communication.
- Since Reclaim uses a websocket, ensure that the reverse proxy is configured to handle websockets.

Your final RPC URL should look something like `wss://<your-domain>/ws`. To use your server on a mobile device via browser RPC, you can load the page at: `https://<your-domain>/browser-rpc`.