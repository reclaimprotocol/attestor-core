# Reclaim Witness

Prove arbritrary claims about the internet with the Reclaim protocol.

TLDR: The witness is a server that sits between the reclaim user & the internet. The client sends data to the internet via the witness. All this data is exchanged securely via the TLS protocol.
We leverage some special properties of the TLS protocol along with zero-knowledge proofs to reveal only the necessary information to the witness.
The witness then signs this data & sends it back to the client. The client can then use this signed data to prove the claim to anyone.

Read a longer brief [here](docs/problem-statement.md).

This repository contains the witness server & the SDK to interact with it.

## Install

The SDK is compatible with the browser & NodeJS.
To run the SDK on React Native/Mobile, keep reading.

### Installing in a project

`npm install git+https://gitlab.reclaimprotocol.org/reclaim-clients/witness-sdk`

**Note:** this approach is only advised for NodeJS projects or projects meant to run directly in a modern browser. For React Native or any solution running in a mobile app, refer to our doc [here](docs/react-native.md).

### Running your own witness

1. Ensure you have an env file with at least the `PRIVATE_KEY` set. See the [.env.sample](.env.sample) file to see all available options.
2. Optional: build the browser RPC files with `npm run build:browser`. More on this in the [docs](docs/browser-rpc.md).
2. Run the witness server with `npm run start:tsc`. This will start the server on port 8001 by default.

## Getting Started

We'd recommend you go through our documentation in the following order:
1. [Problem Statement](docs/problem-statement.md): Understand the problem we're solving & whether this is the right solution for you.
2. [Getting Started](docs/getting-started.md): Understand how to get started with the witness SDK & create your first claim.