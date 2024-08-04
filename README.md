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

To get started with Reclaim, check out our comprehensive documentation,

[Reclaim Documentation](https://docs.reclaimprotocol.org/)

## Try It Out Yourself

Ready to dive in? Follow our installation guide to set up Reclaim,

[Install Reclaim](https://docs.reclaimprotocol.org/install)

## Security

Reclaim prioritizes user privacy and data security through:

- Enhanced HTTPS protocols
- Cryptographic signing
- Zero-knowledge proofs
- Decentralized attestation

## Contributing

We welcome contributions from the community! Please see our [contributing guidelines](link-to-contributing-guidelines) for more information on how to get involved.

## License

This Organizationa and its projects are lincensed under the [License](./LICENSE)

## Vulnerability Disclosure

We take the security of our protocol very seriously. If you have discovered a security vulnerability in the Reclaim Protocol, we appreciate your help in disclosing it to us in a responsible manner.

For full details on our security policy and how to report vulnerabilities, please refer to our [Security Policy](./SECURITY.md).

Key points:

1. Do not publicly disclose the vulnerability.
2. Email us at security@reclaimprotocol.org with details of the vulnerability.
3. Allow us a reasonable amount of time to respond and fix the issue before making any information public.

We commit to responding promptly, keeping you updated, and acknowledging your contribution if desired.

Thank you for helping keep Reclaim and its users safe!

## Indie Hackers: 

We got you and we hear you, just shoot us an email or Tag us on Twitter/X [@reclaimprotocol](https://x.com/reclaimprotocol) about your use-case and how or what do you plan on making changes for and once approved, you are all good to go
   - Hit us up at indie@reclaimprotocol.org
   - PS. if we like the idea, we may support you with a small grant as well :)

## Contact

- Website: [https://reclaimprotocol.org](https://reclaimprotocol.org)
- Twitter: [@ReclaimProtocol](https://twitter.com/ReclaimProtocol)
- Email: contact@reclaimprotocol.org

For more detailed information about the protocol, please refer to our [whitepaper](https://drive.google.com/file/d/1wmfdtIGPaN9uJBI1DHqN903tP9c_aTG2/view).
