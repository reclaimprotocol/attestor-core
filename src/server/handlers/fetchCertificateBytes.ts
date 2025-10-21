import { concatenateUint8Arrays, loadX509FromPem } from '@reclaimprotocol/tls'

import { CERT_ALLOWED_MIMETYPES, MAX_CERT_SIZE_BYTES } from '#src/config/index.ts'
import type { RPCHandler } from '#src/types/handlers.ts'
import { AttestorError } from '#src/utils/error.ts'

export const fetchCertificateBytes: RPCHandler<'fetchCertificateBytes'> = async(
	{ url },
) => {
	const res = await fetch(url, {
		redirect: 'follow',
		signal: AbortSignal.timeout(10_000)
	})
	if(!res.ok) {
		res.body?.cancel('Not ok')
		throw new AttestorError(
			'ERROR_CERTIFICATE_FETCH_FAILED',
			`Failed to fetch certificate from URL: ${url}, status: ${res.status}`
		)
	}

	const contentType = res.headers.get('content-type')
	if(!contentType || !CERT_ALLOWED_MIMETYPES.includes(contentType)) {
		res.body?.cancel('Mismatch')
		throw new AttestorError(
			'ERROR_CERTIFICATE_FETCH_FAILED',
			`Invalid content-type when fetching certificate from URL: ${url},`
			+ ` content-type: ${contentType}`
		)
	}

	if(!res.body) {
		throw new AttestorError(
			'ERROR_CERTIFICATE_FETCH_FAILED',
			`No body in response when fetching certificate from URL: ${url}`
		)
	}

	let total = 0
	const byteArr: Uint8Array[] = []
	for await (const chunk of res.body) {
		total += chunk.length
		if(total > MAX_CERT_SIZE_BYTES) {
			res.body.cancel('Too many bytes')
			throw new AttestorError(
				'ERROR_CERTIFICATE_FETCH_FAILED',
				`Certificate size exceeds maximum limit of ${MAX_CERT_SIZE_BYTES}b`
			)
		}

		byteArr.push(chunk)
	}

	const bytes = concatenateUint8Arrays(byteArr)
	try {
		const cert = loadX509FromPem(bytes)
		TLS_INTERMEDIATE_CA_CACHE[url] = cert
	} catch(err) {
		throw new AttestorError(
			'ERROR_CERTIFICATE_FETCH_FAILED',
			`Failed to parse certificate, error: ${err.message}`
		)
	}

	return { bytes: concatenateUint8Arrays(byteArr) }
}