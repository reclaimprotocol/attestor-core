# Usage of Zero-Knowledge Proofs

We utilise zero-knowledge proofs to allow a user to prove to the witness that a certain encrypted block decrypts to a certain plaintext without revealing the key used to encrypt the block.

We've written these proofs as Circom circuits, that can be found [here](https://gitlab.reclaimprotocol.org/reclaim/zk-symmetric-crypto). The list of supported symmetric encryption algorithms can also be found there.

We also implement a redaction spec, which allows the user to redact certain slices of the plaintext in the encrypted block. So if a particular block contains some sensitive information, the user can choose to reveal only the non-sensitive parts of the block via the zero-knowledge proof.

## Problem Statement

Let's Alice has access to the following piece of data: `Hi alice123, you have 10,000USD`, where `alice123` is the username and `10,000USD` is the balance. Furthermore, imagine this entire piece of data is encrypted using a symmetric key algorithm such as AES or ChaCha20.

Now, assume Bob also has access to the same ciphertext (encrypted data), but no access to the plaintext inside. Alice would like to prove to Bob that the block corresponds to her having a balance of `10,000USD`, but doesn't want to reveal her username.

This is the exact parallel to Alice having received this piece of data from her bank website in a TLS-encrypted connection. Bob would be our witness in this case.

Of course, if Alice were to send Bob the key used to encrypt the data, Bob would be able to decrypt the data and see the username. He'd also be able to see all other data encrypted with the same key (explained why [here](/docs/claim-creation.md#why-we-need-separate-keys-for-each-chunk)).

This is where zero-knowledge proofs come in, along with the redaction spec.

## Implementation

### Redaction

1. First, Alice will redact the username from the encrypted data. This is done by replacing all sensitive parts of the data with a placeholder. We utilise the character: `*`. Thus, `Hi alice123, you have 10,000USD` becomes `Hi ********, you have 10,000USD`.
2. Next, let's assume our encrypted data is `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6`. We'll replace the same range of characters in the plaintext we redacted with the same number of `*`s in the encrypted data. Thus, our encrypted data now becomes `1a2********f7g8h9i0j1k2l3m4n5o6`.

Now, you may be wondering, do characters in the encrypted data have a 1:1 mapping with characters in the plaintext? The answer is yes, they do for counter mode of encryption. You can how [here](https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation#Counter_(CTR)).

The nice thing is the most popular & recommended symmetric encryption algorithms use counter mode. They are:
	- AES-GCM (128 & 256 bit)
	- ChaCha20-Poly1305

The redaction utilities can be found [here](/src/utils/redactions.ts)

### ZK Proof Generation

1. Alice generates a zero-knowledge proof that the encrypted data `1a2********f7g8h9i0j1k2l3m4n5o6` decrypts to something like `Hi 13bchsu2, you have 10,000USD`.
	- You may notice that the plaintext that has been obtained by decrypting the redacted encrypted data is not the same as the original plaintext or the redacted plaintext. This is fine, and to be expected. We'll term this the `decryptedRedactedCiphertext`.
2. Alice sends this above mentioned proof to Bob, alongside the `decryptedRedactedCiphertext` and the `redactedPlaintext`. In the protobuf, this looks like:
	```protobuf
		message ZKProof {
			/** JSON encoded snarkJS proof */
			string proofJson = 1;
			/** the decrypted ciphertext as output by the ZK proof */
			bytes decryptedRedactedCiphertext = 2;
			/** the plaintext that is fully or partially revealed */
			bytes redactedPlaintext = 3;
			/**
			* start of this specific block
			* in the redactedPlaintext
			*/
			uint32 startIdx = 4;
		}
	```
3. Bob upon receving this "ZKProof" message:
	- First, he'd verify that the `decryptedRedactedCiphertext` is "congruent" with the `redactedPlaintext` Alice sent him.
		- This a simple process of just ensuring that all characters in the `decryptedRedactedCiphertext` are the same as the corresponding characters in the `redactedPlaintext` or are `*`s 
		- This is implemented in [isRedactionCongruent](/src/utils/redactions.ts#L12)
	- Second, he'd redact the same slices in his copy of the encrypted data as Alice did in her copy, using the positions of the `*`s in the `redactedPlaintext`.
	- Finally, he'd verify the zero-knowledge proof with the redacted ciphertext he just produced, & the `decryptedRedactedCiphertext` Alice sent him being inputs to the proof.
	- This fn is implemented as [verifyZkPacket](/src/utils/zk.ts#L272)

The ZKP utilties mentioned above can be found [here](/src/utils/zk.ts)

And that's it! Bob now knows that Alice does indeed have a balance of `10,000USD` without ever knowing her username.