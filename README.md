# Reclaim Protocol

![Reclaim Protocol](./assets/Reclaim.png)

## Overview

Reclaim is a protocol that allows users to prove claims about their online data without requiring cooperation from the websites that hold that data. It enables secure, privacy-preserving credential management and verification.

## Architecture

The Reclaim protocol consists of several components:

1. Client-side libraries for generating proofs
2. Attestor node software
3. Reclaim blockchain for managing the token economy and storing proofs
4. Smart contracts for handling claim requests and attestations

## Key Features

- Generate Proofs of Provenance (PoP) for data received through TLS/HTTPS connections
- Selective reveal of data, allowing users to share only specific parts of their information
- Zero-knowledge proofs to maintain user privacy
- Decentralized attestation system
- Economic incentives for honest behavior
- Custom blockchain to facilitate protocol operations and token economy

## How It Works

Reclaim Protocol generates cryptographic proofs on HTTPS traffic. The type of cryptographic proof it generates is called a [zero knowledge proof](https://en.wikipedia.org/wiki/Zero-knowledge_proof). It lets the user generate the proof without knowledge of anything other than what the user wants to share with you. The Protocol is built upon open standards such as HTTPS and TLS.

You can learn more here

- [A non technical overview of how Reclaim Works](https://blog.reclaimprotocol.org/posts/what-is-reclaimprotocol)
- [A technical deepdive via our Whitepaper](https://link.reclaimprotocol.org/whitepaper-draft)

## Use Cases

- Prove you're a 5-star driver without sharing your license plate number
- Demonstrate your credit score without revealing your bank account details
- Verify employment or income without exposing your full pay stub

## For Developers

Easily integrate Reclaim into your app to securely verify user credentials from any website. Our protocol handles the complex cryptography, so you don't have to.

## Getting Started

To get started with Reclaim, check out our comprehensive documentation, [Reclaim Documentation](https://docs.reclaimprotocol.org/).

For an intro to this package & how it works, check out our [Getting Started Guide](/docs/readme.md).

## Try It Out Yourself

Ready to dive in? Follow our installation guide to set up Reclaim,

[Install Reclaim](https://docs.reclaimprotocol.org/install)

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

This project is licensed under a [custom license](https://github.com/reclaimprotocol/.github/blob/main/LICENSE). By contributing to this project, you agree that your contributions will be licensed under its terms.

Thank you for your contributions!
