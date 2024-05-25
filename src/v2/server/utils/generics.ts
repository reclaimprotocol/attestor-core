import { REDACTION_CHAR_CODE } from '@reclaimprotocol/circom-symmetric-crypto'
import { CONTENT_TYPE_MAP, strToUint8Array } from '@reclaimprotocol/tls'
import { ServiceSignatureType } from '../../../proto/api'
import { SIGNATURES } from '../../../signatures'
import { IDecryptedTranscript } from '../../../types'
import { WitnessError } from '../../../utils'
import { Transcript } from '../../types'

const PRIVATE_KEY = process.env.PRIVATE_KEY!

const DEFAULT_REDACTION_DATA = new Uint8Array(4)
	.fill(REDACTION_CHAR_CODE)

/**
 * Sign using the witness's private key.
 */
export function signAsWitness(
	data: Uint8Array | string,
	scheme: ServiceSignatureType
) {
	const { sign } = SIGNATURES[scheme]
	return sign(
		typeof data === 'string' ? strToUint8Array(data) : data,
		PRIVATE_KEY
	)
}


/**
 * Finds all application data messages in a transcript
 * and returns them. Removes the "contentType" suffix from the message.
 * in TLS 1.3
 */
export function extractApplicationDataFromTranscript(
	{ transcript, tlsVersion }: IDecryptedTranscript,
) {
	const msgs: Transcript<Uint8Array> = []
	for(const m of transcript) {
		let message: Uint8Array
		// redacted msgs but with a valid packet header
		// can be considered application data messages
		if(m.redacted) {
			if(!m.plaintextLength) {
				message = DEFAULT_REDACTION_DATA
			} else {
				const len = tlsVersion === 'TLS1_3'
					// remove content type suffix
					? m.plaintextLength - 1
					: m.plaintextLength
				message = new Uint8Array(len)
					.fill(REDACTION_CHAR_CODE)
			}
			// otherwise, we need to check the content type
		} else if(tlsVersion === 'TLS1_3') {
			const contentType = m.message[m.message.length - 1]
			if(contentType !== CONTENT_TYPE_MAP['APPLICATION_DATA']) {
				continue
			}

			message = m.message.slice(0, -1)
		} else {
			message = m.message
		}

		msgs.push({ message, sender: m.sender })
	}

	return msgs
}

/**
 * Nice parse JSON with a key.
 * If the data is empty, returns an empty object.
 * And if the JSON is invalid, throws a bad request error,
 * with the key in the error message.
 */
export function niceParseJsonObject(data: string, key: string) {
	if(!data) {
		return {}
	}

	try {
		return JSON.parse(data)
	} catch(e) {
		throw WitnessError.badRequest(
			`Invalid JSON in ${key}: ${e.message}`,
		)
	}
}