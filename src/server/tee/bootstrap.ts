import { Wallet } from 'ethers'

import {
	startAttestationRefresh
} from '#src/server/tee/attestation-generate.ts'
import {
	bootstrapCertificate,
	getActiveCertificate,
	startRenewalLoop
} from '#src/server/tee/cert-manager.ts'
import { installCloudLogging } from '#src/server/tee/cloud-logging.ts'
import { loadSecretsIntoEnv } from '#src/server/tee/secret-loader.ts'
import { logger as LOGGER } from '#src/utils/logger.ts'

function requireEnv(name: string): string {
	const v = process.env[name]
	if(!v) {
		throw new Error(`tee bootstrap: ${name} is required`)
	}

	return v
}

/**
 * Brings the attestor up in TEE mode:
 *   1. Pull signing/OPRF secrets from GCP Secret Manager into process.env.
 *   2. Load (or obtain via ACME) the TLS cert and start the renewal loop.
 *   3. Start the attestation refresh loop, with the public key + cert hash
 *      as nonces.
 *
 * Must run before #src/server/index.ts is imported, since modules in that
 * tree read PRIVATE_KEY at module load.
 */
export async function bootstrapTee(): Promise<void> {
	const projectId = requireEnv('GOOGLE_PROJECT_ID')
	const domain = requireEnv('ENCLAVE_DOMAIN')
	const email = requireEnv('ACME_EMAIL')
	const directoryUrl = process.env.ACME_DIRECTORY_URL
		|| 'https://acme-v02.api.letsencrypt.org/directory'
	const httpChallengePort = +(process.env.HTTP_PORT || 80)
	const logName = process.env.LOG_NAME || 'attestor-core'

	installCloudLogging({ projectId, logName })
	LOGGER.info({ projectId, domain }, 'tee: bootstrap start')

	await loadSecretsIntoEnv(projectId)

	const cfg = { projectId, domain, email, directoryUrl, httpChallengePort }
	await bootstrapCertificate(cfg)
	startRenewalLoop(cfg)

	const signingKey = process.env.PRIVATE_KEY
	if(!signingKey) {
		throw new Error('tee bootstrap: PRIVATE_KEY missing after secret load')
	}

	const attestorAddress = new Wallet(signingKey).address
	await startAttestationRefresh({
		attestorAddress,
		tlsCertSha256Hex: () => getActiveCertificate()?.sha256Hex
	})

	LOGGER.info({ attestorAddress, domain }, 'tee: bootstrap complete')
}
