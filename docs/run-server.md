# Run your own Attestor

## Running a Attestor Locally

1. Of course, clone this repository.
2. Ensure you have an env file with at least the `PRIVATE_KEY` set. See the [.env.sample](.env.sample) file to see all available options.
3. Optional: build the browser RPC files with `npm run build:browser`. More on this in the [docs](docs/browser-rpc.md).
4. Run the attestor server with `npm run start:tsc`. This will start the server on port 8001 by default.

### Enabling TOPRF

We support threshholded [OPRF](https://en.wikipedia.org/wiki/Oblivious_pseudorandom_function) to obscure sensitive data in a proof in a consistent way. This is optional but requires additional setup. Here is how to enable it:
1. Create TOPRF keys with `npm run generate:toprf-keys`. This will print out environment variables required for TOPRF.
2. From the output of the above cmd, you must add:
	- `TOPRF_PUBLIC_KEY`
	- One of the key shares specified by `TOPRF_SHARE_PUBLIC_KEY` & `TOPRF_SHARE_PRIVATE_KEY`

## Deploying to the Cloud

You can deploy your own Reclaim server via the [docker-compose](/docker-compose.yaml). The Reclaim server is a stateless machine so you can scale it horizontally as much as you want.

With the docker compose up:
- Expose the Reclaim HTTP server behind a reverse proxy (like nginx) to the internet.
- Add HTTPS to the reverse proxy to ensure secure communication.
- Since Reclaim uses a websocket, ensure that the reverse proxy is configured to handle websockets.

Your final RPC URL should look something like `wss://<your-domain>/ws`. To use your server on a mobile device via browser RPC, you can load the page at: `https://<your-domain>/browser-rpc`.