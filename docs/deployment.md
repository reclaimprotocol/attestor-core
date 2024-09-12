# Deploying your own Operator

You can deploy your own Reclaim server via the [docker-compose](/docker-compose.yaml). The Reclaim server is a stateless machine so you can scale it horizontally as much as you want.

With the docker compose up:
- Expose the Reclaim HTTP server behind a reverse proxy (like nginx) to the internet.
- Add HTTPS to the reverse proxy to ensure secure communication.
- Since Reclaim uses a websocket, ensure that the reverse proxy is configured to handle websockets.

Your final RPC URL should look something like `wss://<your-domain>/ws`. To use your server on a mobile device via browser RPC, you can load the page at: `https://<your-domain>/browser-rpc`.