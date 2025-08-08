import { randomBytes } from 'crypto'
import assert from 'node:assert'
import type { Mock } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import type { ClaimTunnelRequest } from '#src/proto/api.ts'
import { SPY_PREPARER } from '#src/tests/mocks.ts'

export const delay = setTimeout

export function randomPrivateKey() {
	return '0x' + randomBytes(32).toString('hex')
}

export function getRandomPort() {
	return Math.floor(Math.random() * 5000 + 5000)
}

/**
 * Verifies that no direct reveal accidentally leaked
 * the key. This is done by checking that no other
 * application data packets were sent with the same key
 *
 * Uses the spy on preparePacketsForReveal to get the
 * tls transcript and reveals map that was used.
 */
export function verifyNoDirectRevealLeaks() {
	if(!SPY_PREPARER.mock.calls.length) {
		return
	}

	const [
		{ arguments: [tlsTranscript, revealsMap] }
	] = SPY_PREPARER.mock.calls
	for(const [packet, reveal] of revealsMap.entries()) {
		if(reveal.type !== 'complete') {
			continue
		}

		if(packet.type === 'plaintext') {
			continue
		}

		// find any other packets with the same key
		// that do not have a reveal & were application data.
		// If we find any, it means we've leaked the key
		const otherPacketsWKey = tlsTranscript
			.filter(({ message }) => (
				message.type === 'ciphertext'
				&& !revealsMap.get(message)
				&& message.encKey === packet.encKey
				&& message.contentType === 'APPLICATION_DATA'
			))
		assert.equal(otherPacketsWKey.length, 0)
	}
}


export async function waitForMockCall<T extends Function>(
	{ mock }: Mock<T>,
	timeoutMs = 5000
) {
	const start = Date.now()
	while(!mock.calls.length) {
		if(Date.now() - start > timeoutMs) {
			throw new Error('Timed out waiting for mock call')
		}

		await delay(100)
	}
}

/**
 * Gets the first TOPRF block from the transcript.
 * Returns undefined if no TOPRF block is found.
 */
export function getFirstTOprfBlock({ transcript }: ClaimTunnelRequest) {
	for(const { reveal } of transcript) {
		for(const proof of reveal?.zkReveal?.proofs || []) {
			if(proof.toprf)	{
				return proof.toprf
			}
		}
	}
}

export const TEST_RES_BODY_CHUNKS = [
	'{"name":"John",',
	'"age":30,',
	'"car":null,',
	'"house":"some',
	'where"}'
]

/**
 * A chunked response with the body split into multiple chunks
 */
export const TEST_RES_CHUNKED_PARTIAL_BODY = [
	'HTTP/1.1 200 OK',
	'Content-Type: application/json',
	'Transfer-Encoding: chunked',
	'',
	...TEST_RES_BODY_CHUNKS.flatMap((chunk) => {
		const chunkSize = chunk.length.toString(16)
		return [chunkSize, chunk]
	}),
	'0',
	'',
	''
].join('\r\n')