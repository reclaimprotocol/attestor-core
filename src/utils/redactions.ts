import { concatenateUint8Arrays } from '@reclaimprotocol/tls'
import { TOPRFPayload } from 'src/proto/api'
import type { ArraySlice, RedactedOrHashedArraySlice } from 'src/types'

export const REDACTION_CHAR = '*'
export const REDACTION_CHAR_CODE = REDACTION_CHAR.charCodeAt(0)

type SliceWithReveal<T> = {
	block: T
	redactedPlaintext: Uint8Array
	/**
	 * If the block has a TOPRF claim -- it'll be set here
	 */
	toprf?: TOPRFPayload
}

export type RevealedSlices<T> = 'all' | SliceWithReveal<T>[]

/**
 * Check if a redacted string is congruent with the original string.
 * @param redacted the redacted content, redacted content is replaced by '*'
 * @param original the original content
 */
export function isRedactionCongruent<T extends string | Uint8Array>(
	redacted: T,
	original: T
): boolean {
	// eslint-disable-next-line unicorn/no-for-loop
	for(let i = 0;i < redacted.length;i++) {
		const element = redacted[i]
		const areSame = element === original[i]
			|| (typeof element === 'string' && element === REDACTION_CHAR)
			|| (typeof element === 'number' && element === REDACTION_CHAR_CODE)
		if(!areSame) {
			return false
		}
	}

	return true
}

/**
 * Is the string fully redacted?
 */
export function isFullyRedacted<T extends string | Uint8Array>(
	redacted: T
): boolean {
	for(const element of redacted) {
		if(
			element !== REDACTION_CHAR
			&& element !== REDACTION_CHAR_CODE
		) {
			return false
		}
	}

	return true
}

/**
 * Given some plaintext blocks and a redaction function, return the blocks that
 * need to be revealed to the other party
 *
 * Use case: we get the response for a request in several blocks, and want to redact
 * pieces that go through multiple blocks. We can use this function to get the
 * blocks that need to be revealed to the other party
 *
 * @example if we received ["secret is 12","345","678. Thanks"]. We'd want
 * to redact the "12345678" and reveal the rest. We'd pass in the blocks and
 * the redact function will return the redactions, namely [10,19].
 * The function will return the blocks ["secret is **","***. Thanks"].
 * The middle block is fully redacted, so it's not returned
 *
 * @param blocks blocks to reveal
 * @param redact function that returns the redactions
 * @returns blocks to reveal
 */
export async function getBlocksToReveal<T extends { plaintext: Uint8Array }>(
	blocks: T[],
	redact: (total: Uint8Array) => RedactedOrHashedArraySlice[],
	performOprf: (plaintext: Uint8Array) => Promise<TOPRFPayload>
) {
	const slicesWithReveal: SliceWithReveal<T>[] = blocks.map(block => ({
		block,
		// copy the plaintext to avoid mutating the original
		redactedPlaintext: new Uint8Array(block.plaintext)
	}))
	const total = concatenateUint8Arrays(
		blocks.map(b => b.plaintext)
	)
	const redactions = redact(total)

	if(!redactions.length) {
		return 'all'
	}

	let blockIdx = 0
	let cursorInBlock = 0
	let cursor = 0

	for(const redaction of redactions) {
		await redactBlocks(redaction)
	}

	// only reveal blocks that have some data to reveal,
	// or are completely plaintext
	return slicesWithReveal
		.filter(s => !isFullyRedacted(s.redactedPlaintext))

	async function redactBlocks(slice: RedactedOrHashedArraySlice) {
		while(cursor < slice.fromIndex) {
			advance()
		}

		if(slice.type === 'hashed') {
			// because of the nature of our ZK circuit -- we can only
			// prove a single hash per block. So we need to make sure
			// we don't have a TOPRF claim already
			if(slicesWithReveal[blockIdx].toprf) {
				throw new Error(
					`Block (${blockIdx}) already has a TOPRF claim.`
					+ ' Cannot add another OPRF claim again'
				)
			}

			const plaintext = total.slice(slice.fromIndex, slice.toIndex)
			const { nullifier, responses } = await performOprf(plaintext)

			// set the TOPRF claim on the first blocks this
			// redaction covers
			slicesWithReveal[blockIdx].toprf = {
				nullifier,
				responses,
				dataLocation: {
					fromIndex: cursorInBlock,
					length: slice.toIndex - slice.fromIndex
				}
			}

			let i = 0
			while(cursor < slice.toIndex) {
				slicesWithReveal[blockIdx]
					.redactedPlaintext[cursorInBlock] = nullifier.at(i)!
				advance()

				i += 1
			}
		}

		while(cursor < slice.toIndex) {
			slicesWithReveal[blockIdx]
				.redactedPlaintext[cursorInBlock] = REDACTION_CHAR_CODE
			advance()
		}
	}

	function advance() {
		cursor += 1
		cursorInBlock += 1
		if(cursorInBlock >= blocks[blockIdx].plaintext.length) {
			blockIdx += 1
			cursorInBlock = 0
		}
	}
}

/**
 * Redact the following slices from the total
 */
export function redactSlices(total: Uint8Array, slices: ArraySlice[]) {
	const redacted = new Uint8Array(total)

	for(const slice of slices) {
		for(let i = slice.fromIndex;i < slice.toIndex;i++) {
			redacted[i] = REDACTION_CHAR_CODE
		}
	}

	return redacted
}