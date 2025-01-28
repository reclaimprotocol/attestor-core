import { readFile } from 'fs/promises'
import { getCliArgument } from 'src/scripts/utils'
import { createServer, decryptTranscript } from 'src/server'
import { assertValidateProviderParams } from 'src/utils'
import { getEnvVariable } from 'src/utils/env'
import { WebSocketServer } from 'ws'
import 'src/server/utils/config-env'
import {
	API_SERVER_PORT,
	createClaimOnAttestor,
	getAttestorClientFromPool,
	getTranscriptString,
	logger,
	ProviderName,
	ProviderParams,
	providers,
	ProviderSecretParams,
	WS_PATHNAME,
} from '..'

type ProviderReceiptGenerationParams<P extends ProviderName> = {
    name: P
    params: ProviderParams<P>
    secretParams: ProviderSecretParams<P>
}

// tmp change till we move OPRF attestor to prod
const DEFAULT_ATTESTOR_HOST_PORT = 'wss://attestor.reclaimprotocol.org/ws'
const PRIVATE_KEY_HEX = getEnvVariable('PRIVATE_KEY_HEX')
	// demo private key
	|| '0x0123788edad59d7c013cdc85e4372f350f828e2cec62d9a2de4560e69aec7f89'

let server: WebSocketServer | undefined

export async function main<T extends ProviderName>(
	receiptParams?: ProviderReceiptGenerationParams<T>
) {
	const paramsJson = receiptParams ?? (await getInputParameters())
	if(!(paramsJson.name in providers)) {
		throw new Error(`Unknown provider "${paramsJson.name}"`)
	}

	assertValidateProviderParams<'http'>(paramsJson.name, paramsJson.params)

	let attestorHostPort = getCliArgument('attestor')
        || DEFAULT_ATTESTOR_HOST_PORT
	if(attestorHostPort === 'local') {
		console.log('starting local attestor server...')
		server = await createServer()
		attestorHostPort = `ws://localhost:${API_SERVER_PORT}${WS_PATHNAME}`
	}

	const zkEngine = getCliArgument('zk') === 'gnark' ? 'gnark' : 'snarkjs'
	const receipt = await createClaimOnAttestor({
		name: paramsJson.name,
		secretParams: paramsJson.secretParams,
		params: paramsJson.params,
		ownerPrivateKey: PRIVATE_KEY_HEX,
		client: { url: attestorHostPort },
		logger,
		zkEngine
	})

	if(receipt.error) {
		console.error('claim creation failed:', receipt.error)
	} else {
		const ctx = receipt.claim?.context
			? JSON.parse(receipt.claim.context)
			: {}
		console.log(`receipt is valid for ${paramsJson.name} provider`)
		if(ctx.extractedParameters) {
			console.log('extracted params:', ctx.extractedParameters)
		}
	}

	const decTranscript = await decryptTranscript(
		receipt.request?.transcript!,
		logger,
		zkEngine,
		receipt.request?.fixedServerIV!,
		receipt.request?.fixedClientIV!
	)
	const transcriptStr = getTranscriptString(decTranscript)
	console.log('receipt:\n', transcriptStr)

	const client = getAttestorClientFromPool(attestorHostPort)
	await client.terminateConnection()

}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getInputParameters(): Promise<ProviderReceiptGenerationParams<any>> {
	const paramsJsonFile = getCliArgument('json')
	if(!paramsJsonFile) {
		const name = getCliArgument('name')
		const paramsStr = getCliArgument('params')
		const secretParamsStr = getCliArgument('secretParams')
		if(!name || !paramsStr || !secretParamsStr) {
			throw new Error('Either provide --json argument for parameters JSON or provide separately with --name, --params & --secretParams')
		}

		return {
			name,
			params: JSON.parse(paramsStr),
			secretParams: JSON.parse(secretParamsStr)
		}
	}

	let fileContents = await readFile(paramsJsonFile, 'utf8')
	for(const variable in process.env) {
		fileContents = fileContents.replace(
			`{{${variable}}}`,
            process.env[variable]!
		)
	}

	return JSON.parse(fileContents)
}

if(require.main === module) {
	main()
		.catch(err => {
			console.error('error in receipt gen', err)
		})
		.finally(() => {
			server?.close()
		})
}

