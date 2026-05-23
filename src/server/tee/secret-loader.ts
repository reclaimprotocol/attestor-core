import { accessLatestSecret } from '#src/server/tee/secret-manager.ts'
import { logger } from '#src/utils/logger.ts'

const SECRET_TO_ENV: Record<string, string> = {
	'attestor-signing-key': 'PRIVATE_KEY',
	'attestor-toprf-share-private': 'TOPRF_SHARE_PRIVATE_KEY',
	'attestor-toprf-share-public': 'TOPRF_SHARE_PUBLIC_KEY',
	'attestor-toprf-public': 'TOPRF_PUBLIC_KEY'
}

/**
 * Fetches the attestor's signing key and OPRF key material from GCP
 * Secret Manager and writes them into process.env, so that the rest of
 * the server (which reads these via getEnvVariable at module load) sees
 * them as if they had been set in the environment.
 *
 * Must be called before any module that reads PRIVATE_KEY / TOPRF_* is
 * imported, otherwise the reads happen before the values are populated.
 */
export async function loadSecretsIntoEnv(projectId: string): Promise<void> {
	for(const [secretId, envName] of Object.entries(SECRET_TO_ENV)) {
		if(process.env[envName]) {
			logger.info({ envName }, 'tee: env already set, skipping secret fetch')
			continue
		}

		const bytes = await accessLatestSecret(projectId, secretId)
		process.env[envName] = Buffer.from(bytes).toString('utf8').trim()
		logger.info({ envName, secretId }, 'tee: loaded secret into env')
	}
}
