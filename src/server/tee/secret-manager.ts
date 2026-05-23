import { SecretManagerServiceClient } from '@google-cloud/secret-manager'

let cachedClient: SecretManagerServiceClient | undefined

function getClient() {
	if(!cachedClient) {
		cachedClient = new SecretManagerServiceClient()
	}

	return cachedClient
}

export async function accessLatestSecret(
	projectId: string,
	secretId: string
): Promise<Uint8Array> {
	const [resp] = await getClient().accessSecretVersion({
		name: `projects/${projectId}/secrets/${secretId}/versions/latest`
	})
	const data = resp.payload?.data
	if(!data) {
		throw new Error(`secret ${secretId} has no payload`)
	}

	return typeof data === 'string' ? Buffer.from(data, 'utf8') : data
}

export async function createSecretIfNotExists(
	projectId: string,
	secretId: string
): Promise<void> {
	try {
		await getClient().createSecret({
			parent: `projects/${projectId}`,
			secretId,
			secret: {
				replication: { automatic: {} }
			}
		})
	} catch(err) {
		// ALREADY_EXISTS (gRPC status 6) is fine; rethrow anything else.
		if((err as { code?: number }).code !== 6) {
			throw err
		}
	}
}

export async function addSecretVersion(
	projectId: string,
	secretId: string,
	payload: Uint8Array
): Promise<void> {
	await getClient().addSecretVersion({
		parent: `projects/${projectId}/secrets/${secretId}`,
		payload: { data: payload }
	})
}
