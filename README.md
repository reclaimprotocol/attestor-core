# Reclaim Witness

Prove arbritrary claims about the internet with the Reclaim protocol.

TLDR: The witness is a server that sits between the reclaim user & the internet. The client sends data to the internet via the witness. All this data is exchanged securely via the TLS protocol.
We leverage some special properties of the TLS protocol along with zero-knowledge proofs to reveal only the necessary information to the witness.
The witness then signs this data & sends it back to the client. The client can then use this signed data to prove the claim to anyone.

Read a longer brief [here](docs/problem-statement.md).

This repository contains **Typescript** implementation of the witness server & the SDK to interact with it. The SDK is compatible with the browser & NodeJS. However, to run the SDK on React Native/Mobile, refer to our [React Native guide](docs/browser-rpc.md).

## Install

`npm install git+https://gitlab.reclaimprotocol.org/reclaim-clients/witness-sdk`

**Note:** this approach is only advised for NodeJS projects or projects meant to run directly in a modern browser. For React Native or any solution running in a mobile app, refer to our doc [here](docs/browser-rpc.md).

## Running your own witness

1. Of course, clone this repository.
2. Ensure you have an env file with at least the `PRIVATE_KEY` set. See the [.env.sample](.env.sample) file to see all available options.
3. Optional: build the browser RPC files with `npm run build:browser`. More on this in the [docs](docs/browser-rpc.md).
4. Run the witness server with `npm run start:tsc`. This will start the server on port 8001 by default.

## Getting Started

We'd recommend you go through our documentation in the following order:
1. [Problem Statement](docs/problem-statement.md): Understand the problem we're solving & whether this is the right solution for you.
2. [Getting Started](docs/getting-started.md): Understand how to get started with the witness SDK & create your first claim.
3. [Browser RPC/React Native](docs/browser-rpc.md): How to setup the witness SDK for environments like React Native or any other mobile app.
4. [Provider](docs/provider.md): What is a provider in the Reclaim context, how to create one & details on the HTTP provider.
5. [Internals of Claim Creation](docs/claim-creation.md): In-depth description of the full flow of creating a claim with a witness.