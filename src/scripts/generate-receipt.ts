import { readFile } from 'fs/promises'
import P from 'pino'
import { WebSocketServer } from 'ws'
import '../server/utils/config-env'
import { decryptTranscript, createServer } from '../server'
import {
	API_SERVER_PORT,
	createClaimOnWitness,
	getTranscriptString,
	getWitnessClientFromPool,
	ProviderName,
	ProviderParams,
	providers,
	ProviderSecretParams } from '..'

type ProviderReceiptGenerationParams<P extends ProviderName> = {
    name: P
    params: ProviderParams<P>
    secretParams: ProviderSecretParams<P>
}

const DEFAULT_WITNESS_HOST_PORT = 'https://reclaim-node.questbook.app'
const PRIVATE_KEY_HEX = process.env.PRIVATE_KEY
	// demo private key
	|| '0x0123788edad59d7c013cdc85e4372f350f828e2cec62d9a2de4560e69aec7f89'

const logger = P()
logger.level = process.env.LOG_LEVEL || 'info'

export async function main<T extends ProviderName>(
	receiptParams?: ProviderReceiptGenerationParams<T>
) {
	const paramsJson = receiptParams ?? (await getInputParameters())
	if(!(paramsJson.name in providers)) {
		throw new Error(`Unknown provider "${paramsJson.name}"`)
	}

	if(
		!providers[paramsJson.name].areValidParams(paramsJson.params)
	) {
		throw new Error(`Invalid parameters for provider "${paramsJson.name}"`)
	}

	let witnessHostPort = getCliArgument('witness')
        || DEFAULT_WITNESS_HOST_PORT
	let server: WebSocketServer | undefined
	if(witnessHostPort === 'local') {
		console.log('starting local witness server...')
		server = await createServer()
		witnessHostPort = `ws://localhost:${API_SERVER_PORT}`
	}

	console.log('connected, creating claim...')

	const receipt = await createClaimOnWitness({
		name: paramsJson.name,
		secretParams: paramsJson.secretParams,
		params: paramsJson.params,
		ownerPrivateKey: PRIVATE_KEY_HEX,
		client: { url: witnessHostPort },
		logger,
	})

	const decTranscript = await decryptTranscript(
		receipt.request?.transcript!,
		logger
	)
	const transcriptStr = getTranscriptString(decTranscript)
	console.log('receipt:\n', transcriptStr)

	if(receipt.error) {
		console.error('claim creation failed:', receipt.error)
	} else {
		const ctx = receipt.claim?.context
			? JSON.parse(receipt.claim.context)
			: {}
		console.log(`receipt is valid for ${paramsJson.name} provider`)
		if(ctx.extractedParams) {
			console.log('extracted params:', ctx.extractedParams)
		}
	}

	const client = getWitnessClientFromPool(witnessHostPort)
	await client.terminateConnection()
	server?.close()
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

function getCliArgument(arg: string) {
	const index = process.argv.indexOf(`--${arg}`)
	if(index === -1) {
		return undefined
	}

	return process.argv[index + 1]
}

if(require.main === module) {
	main()
		.catch(err => {
			console.error('error in receipt gen', err)
		})
}

