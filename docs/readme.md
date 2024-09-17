# Reclaim Attestor

Prove arbritrary claims about the internet with the Reclaim protocol.

TLDR: The attestor is a server that sits between the reclaim user & the internet. The client sends data to the internet via the attestor. All this data is exchanged securely via the TLS protocol.
We leverage some special properties of the TLS protocol along with zero-knowledge proofs to reveal only the necessary information to the attestor.
The attestor then signs this data & sends it back to the client. The client can then use this signed data to prove the claim to anyone.

Read a longer brief [here](docs/problem-statement.md).

This repository contains **Typescript** implementation of the attestor server & the SDK to interact with it. The SDK is compatible with the browser & NodeJS. However, to run the SDK on React Native/Mobile, refer to our [React Native guide](docs/browser-rpc.md).

## Install

`npm install git+https://gitlab.reclaimprotocol.org/protocol/attestor-core`

or

`npm install git+https://github.com/reclaimprotocol/attestor-core`

**Note:** this approach is only advised for NodeJS projects or projects meant to run directly in a modern browser. For React Native or any solution running in a mobile app, refer to our doc [here](docs/browser-rpc.md).

Note for devs: the "prepare" script which is run after `npm install` is configured to only build when there are files in the `src` directory. This is to prevent errors when building the Docker image.

## Getting Started

We'd recommend you go through our documentation in the following order:
1. [Problem Statement](docs/problem-statement.md): Understand the problem we're solving & whether this is the right solution for you.
2. [Getting Started](docs/getting-started.md): Understand how to get started with the attestor SDK & create your first claim.
3. [Browser RPC/React Native](docs/browser-rpc.md): How to setup the attestor client SDK for environments like React Native or any other mobile app.
4. [Provider](docs/provider.md): What is a provider in the Reclaim context, how to create one & details on the HTTP provider.
5. [Internals of Claim Creation](docs/claim-creation.md): In-depth description of the full flow of creating a claim with a attestor.
6. [Working with the Codebase](docs/project.md): Understand how to work with the codebase & how to deploy an attestor server.
6. [AVS](docs/avs.md): Understand how we use an Eigen AVS to decentralize the attestor server.