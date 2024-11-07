# Reclaim Attestor Core

<div>
    <div>
        <img src="https://raw.githubusercontent.com/reclaimprotocol/.github/main/assets/banners/Attestor-Core.png"  />
    </div>
</div>


![Test status](https://github.com/ReclaimProtocol/attestor-core/actions/workflows/ci-cd.yml/badge.svg?job=test)
![Deploy status](https://github.com/ReclaimProtocol/attestor-core/actions/workflows/ci-cd.yml/badge.svg?job=deploy)

## What is the Reclaim Protocol?

Reclaim enables you to bring user activity, reputation, and identity from external websites into your own platform.

For example,
- Import the number of rides the user has taken on Uber to build a competing ride sharing platform
- Import the users purchasing preferences using Amazon to provide discounts to the right users
- Enable economics on a blockchain using users offchain activity data
- Use national IDs to perform KYC

And many more...

### Now what is this repository?

The `attestor-core` package is the core implementation of the Reclaim protocol.

TLDR: An "attestor" is a server that sits between the reclaim user & the internet. The client sends data to the internet via the attestor. All this data is exchanged securely via the TLS protocol.

We leverage some special properties of the TLS protocol along with zero-knowledge proofs to reveal only the necessary information to the attestor.
The attestor then signs this data & sends it back to the client. The client can then use this signed data to prove the claim to anyone.

This package contains both the client & server side code for the Reclaim protocol.

Read a longer brief [here](/docs/problem-statement.md).

This repository contains **Typescript** implementation of the attestor server & the SDK to interact with it. The SDK is compatible with the browser & NodeJS. However, to run the SDK on React Native/Mobile, refer to our [React Native guide](/docs/browser-rpc.md).

Note: if you're looking to build apps on Reclaim, we'd recommend you to use the [Reclaim SDK](https://docs.reclaimprotocol.org/) instead. This repository is intended for developers looking to contribute to the core protocol.

## Install

From GitHub:
`npm install git+https://github.com/reclaimprotocol/attestor-core`

From NPM:
`npm install @reclaimprotocol/attestor-core`

**Note:** if you plan on running the package on NodeJS or any non-browser environment, download the ZK files required to generate & verify ZK proofs:
```bash
npm run download:zk-files
```

**Note:** this approach is only advised for NodeJS projects or projects meant to run directly in a modern browser. For React Native or any solution running in a mobile app, refer to our doc [here](/docs/browser-rpc.md).

Note for devs: the "prepare" script which is run after `npm install` is configured to only build when there are files in the `src` directory. This is to prevent errors when building the Docker image.

## Getting Started

We'd recommend you go through our documentation in the following order:
1. [Problem Statement](/docs/problem-statement.md): Understand the problem we're solving & whether this is the right solution for you.
2. [Getting Started](/docs/getting-started.md): Understand how to get started with the attestor SDK & create your first claim.
3. [Browser RPC/React Native](/docs/browser-rpc.md): How to setup the attestor client SDK for environments like React Native or any other mobile app.
4. [Provider](/docs/provider.md): What is a provider in the Reclaim context, how to create one & details on the HTTP provider.
5. [Internals of Claim Creation](/docs/claim-creation.md): In-depth description of the full flow of creating a claim with a attestor.
6. [Working with the Codebase](/docs/project.md): Understand how to work with the codebase & how to deploy an attestor server.
7. [Run your own Attestor Server](/docs/run-server.md): Understand how to run your own attestor server locally or deploy it to the cloud.
8. [AVS](/docs/avs.md): Understand how we use an Eigen AVS to decentralize the attestor server.

## Contributing to Our Project

We're excited that you're interested in contributing to our project! Before you get started, please take a moment to review the following guidelines.

## Code of Conduct

Please read and follow our [Code of Conduct](https://github.com/reclaimprotocol/.github/blob/main/Code-of-Conduct.md) to ensure a positive and inclusive environment for all contributors.

## Security

If you discover any security-related issues, please refer to our [Security Policy](https://github.com/reclaimprotocol/.github/blob/main/SECURITY.md) for information on how to responsibly disclose vulnerabilities.

## Contributor License Agreement

Before contributing to this project, please read and sign our [Contributor License Agreement (CLA)](https://github.com/reclaimprotocol/.github/blob/main/CLA.md).

## Indie Hackers

For Indie Hackers: [Check out our guidelines and potential grant opportunities](https://github.com/reclaimprotocol/.github/blob/main/Indie-Hackers.md)

## License

This project is licensed under a [AGPL v3](./LICENSE). By contributing to this project, you agree that your contributions will be licensed under its terms.

Thank you for your contributions!