import { randomBytes } from 'crypto'
import { SPY_PREPARER } from 'src/tests/mocks'

export function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

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

	const [tlsTranscript, revealsMap] = SPY_PREPARER.mock.calls[0]
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
		expect(otherPacketsWKey).toHaveLength(0)
	}
}