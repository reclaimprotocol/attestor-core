import { readFile } from 'fs/promises'
import { WebSocketServer } from 'ws'
import '../server/utils/config-env'
import { createServer, decryptTranscript } from '../server'
import { assertValidateProviderParams } from '../utils'
import { getEnvVariable } from '../utils/env'
import {
	API_SERVER_PORT,
	createClaimOnWitness,
	getTranscriptString,
	getWitnessClientFromPool,
	logger,
	ProviderName,
	ProviderParams,
	providers,
	ProviderSecretParams,
	WS_PATHNAME,
} from '..'
import { generateRequstAndResponseFromTranscript } from '../providers/http/utils'

type ProviderReceiptGenerationParams<P extends ProviderName> = {
    name: P
    params: ProviderParams<P>
    secretParams: ProviderSecretParams<P>
}

const DEFAULT_WITNESS_HOST_PORT = 'wss://witness.reclaimprotocol.org/ws'
const PRIVATE_KEY_HEX = getEnvVariable('PRIVATE_KEY_HEX')
	// demo private key
	|| '0x0123788edad59d7c013cdc85e4372f350f828e2cec62d9a2de4560e69aec7f89'

export async function main<T extends ProviderName>(
	receiptParams?: ProviderReceiptGenerationParams<T>
) {
	const paramsJson = receiptParams ?? (await getInputParameters())
	if(!(paramsJson.name in providers)) {
		throw new Error(`Unknown provider "${paramsJson.name}"`)
	}

	assertValidateProviderParams<'http'>(paramsJson.name, paramsJson.params)

	let witnessHostPort = getCliArgument('witness')
        || DEFAULT_WITNESS_HOST_PORT
	let server: WebSocketServer | undefined
	if(witnessHostPort === 'local') {
		console.log('starting local witness server...')
		server = await createServer()
		witnessHostPort = `ws://localhost:${API_SERVER_PORT}${WS_PATHNAME}`
	}

	const receipt = await createClaimOnWitness({
		name: paramsJson.name,
		secretParams: paramsJson.secretParams,
		params: paramsJson.params,
		ownerPrivateKey: PRIVATE_KEY_HEX,
		client: { url: witnessHostPort },
		logger,
		zkEngine:'snarkJS',
		updateProviderParams(transcript,tlsVersion) : Partial<ProviderParams<'http'>> {
			const { req, res } = generateRequstAndResponseFromTranscript(transcript,tlsVersion)
			console.log('request:', req)
			console.log('response:', res)
			return {
				responseRedactions: []
			}
		}
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
		'snarkJS',
	)
	const transcriptStr = getTranscriptString(decTranscript)
	console.log('receipt:\n', transcriptStr)

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

