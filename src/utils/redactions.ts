import { base64Encode } from '@bufbuild/protobuf/wire'
import { concatenateUint8Arrays } from '@reclaimprotocol/tls'
import type { ArraySlice, RedactedOrHashedArraySlice, TOPRFProofParams } from 'src/types'

export const REDACTION_CHAR = '*'
export const REDACTION_CHAR_CODE = REDACTION_CHAR.charCodeAt(0)

type SliceWithReveal<T> = {
	block: T
	redactedPlaintext: Uint8Array
	/**
	 * If the block has some TOPRF claims -- they'll be set here
	 */
	toprfs?: TOPRFProofParams[]
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
	performOprf: (plaintext: Uint8Array) => Promise<TOPRFProofParams>
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

		if(slice.hash) {
			const plaintext = total.slice(slice.fromIndex, slice.toIndex)
			const {
				nullifier, responses, mask
			} = await performOprf(plaintext)

			// set the TOPRF claim on the first blocks this
			// redaction covers
			const toprf: TOPRFProofParams = {
				nullifier,
				responses,
				dataLocation: {
					fromIndex: cursorInBlock,
					length: slice.toIndex - slice.fromIndex
				},
				mask,
				plaintext
			}
			const block = slicesWithReveal[blockIdx]
			block.toprfs ||= []
			block.toprfs.push(toprf)

			const nullifierStr = binaryHashToStr(
				nullifier,
				toprf.dataLocation!.length
			)

			let i = 0
			while(cursor < slice.toIndex) {
				slicesWithReveal[blockIdx].redactedPlaintext[cursorInBlock]
					= nullifierStr.charCodeAt(i)
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

/**
 * Converts the binary hash to an ASCII string of the expected length.
 * If the hash is shorter than the expected length, it will be padded with
 * '0' characters. If it's longer, it will be truncated.
 */
export function binaryHashToStr(hash: Uint8Array, expLength: number) {
	return base64Encode(hash).padEnd(expLength, '0').slice(0, expLength)
}