import { CipherSuite, concatenateUint8Arrays, crypto } from '@reclaimprotocol/tls'
import { FinaliseSessionRequest_Block as PacketToReveal } from '../proto/api'
import { CompleteTLSPacket, Logger } from '../types'
import { makeZkProofGenerator, PrepareZKProofsBaseOpts } from './zk'

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
	packets: CompleteTLSPacket[],
	{ onZkProgress, ...opts }: PreparePacketsForRevealOpts
): Promise<PacketToReveal[]> {
	const packetsToReveal: PacketToReveal[] = []
	const proofGenerator = makeZkProofGenerator(opts)

	let zkPacketsDone = 0

	await Promise.all(packets.map(async(packet) => {
		if(packet.ctx.type === 'plaintext') {
			return
		}

		switch (packet.reveal?.type) {
		case 'complete':
			packetsToReveal.push({
				index: packet.index,
				directReveal: {
					key: await crypto.exportKey(
						packet.ctx.encKey
					),
					iv: packet.ctx.fixedIv,
					recordNumber: packet.ctx.recordNumber,
				},
				zkReveal: undefined,
				authTag: new Uint8Array(0)
			})
			break
		case 'zk':
			// the redacted section can be smaller than the actual
			// plaintext encrypted, in case of TLS1.3 as it has a
			// content type suffix
			packet.reveal.redactedPlaintext = concatenateUint8Arrays([
				packet.reveal.redactedPlaintext,
				packet.ctx.plaintext.slice(
					packet.reveal.redactedPlaintext.length
				)
			])

			await proofGenerator.addPacketToProve(packet)
			break
		default:
			// no reveal
			break
		}
	}))

	const zkPacketsTotal = proofGenerator.getTotalChunksToProve()
	onZkProgress?.(zkPacketsDone, zkPacketsTotal)

	const zkProofs = await proofGenerator.generateProofs(
		() => {
			zkPacketsDone += 1
			onZkProgress?.(zkPacketsDone, zkPacketsTotal)
		}
	)

	packetsToReveal.push(...zkProofs)

	return packetsToReveal
}