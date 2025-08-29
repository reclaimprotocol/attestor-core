import type { CipherSuite, TLSPacketContext } from '@reclaimprotocol/tls'
import { concatenateUint8Arrays, crypto } from '@reclaimprotocol/tls'

import type {
	ClaimTunnelRequest_TranscriptMessage as TranscriptMessage } from '#src/proto/api.ts'
import {
	TranscriptMessageSenderType
} from '#src/proto/api.ts'
import type { CompleteTLSPacket, Logger, MessageRevealInfo, PrepareZKProofsBaseOpts, Transcript } from '#src/types/index.ts'
import { makeZkProofGenerator } from '#src/utils/zk.ts'

export type PreparePacketsForRevealOpts = {
	cipherSuite: CipherSuite
	logger: Logger
	/**
	 * Progress of Zk proof generation
	 */
	onZkProgress?(blocksDone: number, totalBlocks: number): void
} & PrepareZKProofsBaseOpts

/**
 * Prepares the packets for reveal to the server
 * according to the specified reveal type
 */
export async function preparePacketsForReveal(
	tlsTranscript: Transcript<CompleteTLSPacket>,
	reveals: Map<TLSPacketContext, MessageRevealInfo>,
	{ onZkProgress, ...opts }: PreparePacketsForRevealOpts
) {
	const transcript: TranscriptMessage[] = []
	const proofGenerator = await makeZkProofGenerator(opts)

	let zkPacketsDone = 0

	await Promise.all(tlsTranscript.map(async({ message, sender }, i) => {
		const msg: TranscriptMessage = {
			sender: sender === 'client'
				? TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_CLIENT
				: TranscriptMessageSenderType.TRANSCRIPT_MESSAGE_SENDER_TYPE_SERVER,
			message: message.data,
			reveal: undefined
		}
		transcript.push(msg)

		const reveal = reveals.get(message)
		if(!reveal || message.type === 'plaintext') {
			return
		}

		switch (reveal?.type) {
		case 'complete':
			msg.reveal = {
				directReveal: {
					key: await crypto.exportKey(message.encKey),
					iv: message.fixedIv,
					recordNumber: message.recordNumber,
				},
			}
			break
		case 'zk':
			// the redacted section can be smaller than the actual
			// plaintext encrypted, in case of TLS1.3 as it has a
			// content type suffix
			reveal.redactedPlaintext = concatenateUint8Arrays([
				reveal.redactedPlaintext,
				message.plaintext.slice(reveal.redactedPlaintext.length)
			])

			await proofGenerator.addPacketToProve(
				message,
				reveal,
				proofs => (msg.reveal = { zkReveal: { proofs } }),
				() => {
					const next = tlsTranscript
						.slice(i + 1)
						.find(t => t.sender === sender)
					return next?.message
				}
			)
			break
		default:
			// no reveal
			break
		}
	}))

	const zkPacketsTotal = proofGenerator.getTotalChunksToProve()
	onZkProgress?.(zkPacketsDone, zkPacketsTotal)

	await proofGenerator.generateProofs(
		() => {
			zkPacketsDone += 1
			onZkProgress?.(zkPacketsDone, zkPacketsTotal)
		}
	)

	return transcript
}