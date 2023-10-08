import { concatenateUint8Arrays, crypto, SUPPORTED_CIPHER_SUITE_MAP } from '@reclaimprotocol/tls'
import { FinaliseSessionRequest_Block as PacketToReveal } from '../proto/api'
import { CompleteTLSPacket, Logger } from '../types'
import { makeZkProofGenerator, PrepareZKProofsBaseOpts } from './zk'

type PreparePacketsForRevealOpts = {
	cipherSuite: keyof typeof SUPPORTED_CIPHER_SUITE_MAP
	logger: Logger
} & PrepareZKProofsBaseOpts

/**
 * Prepares the packets for reveal to the server
 * according to the specified reveal type
 */
export async function preparePacketsForReveal(
	packets: CompleteTLSPacket[],
	opts: PreparePacketsForRevealOpts
): Promise<PacketToReveal[]> {
	const packetsToReveal: PacketToReveal[] = []
	const proofGenerator = makeZkProofGenerator(opts)
	const proofTasks: Promise<void>[] = []

	for(const packet of packets) {
		if(packet.ctx.type === 'plaintext') {
			continue
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
				zkReveal: undefined
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

			proofTasks.push((async() => {
				const zkReveal = await proofGenerator
					.generateProof(packet, opts.cipherSuite)
				packetsToReveal.push({
					index: packet.index,
					directReveal: undefined,
					zkReveal
				})
			})())
			break
		default:
			// no reveal
			break
		}
	}

	await Promise.all(proofTasks)

	return packetsToReveal
}