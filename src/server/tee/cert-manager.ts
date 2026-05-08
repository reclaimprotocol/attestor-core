import * as acme from 'acme-client'
import { Buffer } from 'buffer'
import crypto, { X509Certificate } from 'crypto'
import { AcmeChallengeServer } from 'src/server/tee/acme-http-server.ts'
import { accessLatestSecret, addSecretVersion, createSecretIfNotExists } from 'src/server/tee/secret-manager.ts'
import tls from 'tls'

import { logger as LOGGER } from '#src/utils/logger.ts'

const RENEW_IF_EXPIRES_WITHIN_MS = 14 * 24 * 60 * 60 * 1000
const RENEW_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

interface PersistedCert {
	certPem: string
	keyPem: string
}

interface PersistedAccount {
	accountKeyPem: string
	accountUrl?: string
}

export interface CertManagerConfig {
	projectId: string
	domain: string
	email: string
	directoryUrl: string
	httpChallengePort: number
}

export interface ActiveCertificate {
	certPem: string
	keyPem: string
	notAfter: Date
	sha256Hex: string
	secureContext: tls.SecureContext
}

let active: ActiveCertificate | undefined
let renewTimer: NodeJS.Timeout | undefined

function certSecretId(domain: string): string {
	return `attestor-tls-cert-${domain.replaceAll('.', '-')}`
}

function accountSecretId(domain: string): string {
	return `attestor-acme-account-${domain.replaceAll('.', '-')}`
}

async function loadPersistedCert(
	projectId: string,
	domain: string
): Promise<PersistedCert | undefined> {
	try {
		const bytes = await accessLatestSecret(projectId, certSecretId(domain))
		const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as PersistedCert
		if(!json.certPem || !json.keyPem) {
			return undefined
		}

		return json
	} catch(err) {
		LOGGER.info({ err: (err as Error).message }, 'tee: no persisted cert')
		return undefined
	}
}

async function persistCert(
	projectId: string,
	domain: string,
	cert: PersistedCert
): Promise<void> {
	const id = certSecretId(domain)
	await createSecretIfNotExists(projectId, id)
	await addSecretVersion(
		projectId,
		id,
		Buffer.from(JSON.stringify(cert), 'utf8')
	)
}

async function loadPersistedAccount(
	projectId: string,
	domain: string
): Promise<PersistedAccount | undefined> {
	try {
		const bytes = await accessLatestSecret(projectId, accountSecretId(domain))
		return JSON.parse(Buffer.from(bytes).toString('utf8')) as PersistedAccount
	} catch{
		return undefined
	}
}

async function persistAccount(
	projectId: string,
	domain: string,
	account: PersistedAccount
): Promise<void> {
	const id = accountSecretId(domain)
	await createSecretIfNotExists(projectId, id)
	await addSecretVersion(
		projectId,
		id,
		Buffer.from(JSON.stringify(account), 'utf8')
	)
}

function buildActive(cert: PersistedCert): ActiveCertificate {
	const x509 = new X509Certificate(cert.certPem)
	const der = Buffer.from(x509.raw)
	const sha256 = crypto.createHash('sha256').update(der).digest('hex')
	return {
		certPem: cert.certPem,
		keyPem: cert.keyPem,
		notAfter: new Date(x509.validTo),
		sha256Hex: sha256,
		secureContext: tls.createSecureContext({
			cert: cert.certPem,
			key: cert.keyPem
		})
	}
}

function isFresh(cert: PersistedCert): boolean {
	try {
		const x509 = new X509Certificate(cert.certPem)
		const remaining = new Date(x509.validTo).getTime() - Date.now()
		return remaining > RENEW_IF_EXPIRES_WITHIN_MS
	} catch(err) {
		LOGGER.warn({ err: (err as Error).message }, 'tee: cert parse failed')
		return false
	}
}

async function obtainViaAcme(
	cfg: CertManagerConfig
): Promise<PersistedCert> {
	const persistedAccount = await loadPersistedAccount(cfg.projectId, cfg.domain)
	const accountKey = persistedAccount
		? Buffer.from(persistedAccount.accountKeyPem, 'utf8')
		: await acme.crypto.createPrivateKey()

	const client = new acme.Client({
		directoryUrl: cfg.directoryUrl,
		accountKey,
		accountUrl: persistedAccount?.accountUrl
	})

	const [certKey, csr] = await acme.crypto.createCsr({
		commonName: cfg.domain,
		altNames: [cfg.domain]
	})

	const challengeServer = new AcmeChallengeServer()
	await challengeServer.start(cfg.httpChallengePort)
	try {
		const certPem = await client.auto({
			csr,
			email: cfg.email,
			termsOfServiceAgreed: true,
			challengePriority: ['http-01'],
			challengeCreateFn: async(_authz, challenge, keyAuthorization) => {
				if(challenge.type !== 'http-01') {
					throw new Error(`unsupported challenge: ${challenge.type}`)
				}

				challengeServer.add(challenge.token, keyAuthorization)
			},
			challengeRemoveFn: async(_authz, challenge) => {
				challengeServer.remove(challenge.token)
			}
		})

		await persistAccount(cfg.projectId, cfg.domain, {
			accountKeyPem: accountKey.toString('utf8'),
			accountUrl: client.getAccountUrl()
		})

		const result: PersistedCert = {
			certPem,
			keyPem: certKey.toString('utf8')
		}
		await persistCert(cfg.projectId, cfg.domain, result)
		return result
	} finally{
		await challengeServer.stop().catch((err) => {
			LOGGER.warn({ err }, 'tee: acme challenge server stop failed')
		})
	}
}

/**
 * Bootstraps the TLS certificate. Tries Secret Manager first; if absent or
 * expiring within the renewal window, runs ACME against the configured
 * directory URL and persists the result.
 */
export async function bootstrapCertificate(
	cfg: CertManagerConfig
): Promise<ActiveCertificate> {
	const persisted = await loadPersistedCert(cfg.projectId, cfg.domain)
	if(persisted && isFresh(persisted)) {
		LOGGER.info({ domain: cfg.domain }, 'tee: using persisted certificate')
		active = buildActive(persisted)
		return active
	}

	LOGGER.info(
		{ domain: cfg.domain, directoryUrl: cfg.directoryUrl },
		persisted ? 'tee: cert near expiry, renewing' : 'tee: no cert, requesting new'
	)
	const fresh = await obtainViaAcme(cfg)
	active = buildActive(fresh)
	return active
}

export function startRenewalLoop(cfg: CertManagerConfig): void {
	if(renewTimer) {
		clearInterval(renewTimer)
	}

	renewTimer = setInterval(async() => {
		try {
			const remaining = active
				? active.notAfter.getTime() - Date.now()
				: 0
			if(remaining > RENEW_IF_EXPIRES_WITHIN_MS) {
				return
			}

			LOGGER.info(
				{ remainingDays: Math.round(remaining / (24 * 60 * 60 * 1000)) },
				'tee: cert near expiry, renewing'
			)
			const fresh = await obtainViaAcme(cfg)
			active = buildActive(fresh)
		} catch(err) {
			LOGGER.error({ err }, 'tee: cert renewal failed')
		}
	}, RENEW_CHECK_INTERVAL_MS)
	renewTimer.unref?.()
}

export function stopRenewalLoop(): void {
	if(renewTimer) {
		clearInterval(renewTimer)
		renewTimer = undefined
	}
}

export function getActiveCertificate(): ActiveCertificate | undefined {
	return active
}
