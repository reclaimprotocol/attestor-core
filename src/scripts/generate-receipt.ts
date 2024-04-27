import canonicalize from 'canonicalize'
import { config } from 'dotenv'
import { readFile } from 'fs/promises'
import * as niceGrpc from 'nice-grpc'
import P from 'pino'
import {
	createGrpcWebClient,
	generateProviderReceipt,
	getTranscriptString,
	Logger,
	proto,
	ProviderName,
	ProviderParams,
	providers,
	ProviderSecretParams
} from '..'

config()

export type ProviderReceiptGenerationParams<P extends ProviderName> = {
    name: P
    params: ProviderParams<P>
    secretParams: ProviderSecretParams<P>
}

const DEFAULT_WITNESS_HOST_PORT = 'https://reclaim-node.questbook.app'
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

	const witnessHostPort = getCliArgument('witness')
        || DEFAULT_WITNESS_HOST_PORT
	const client = getWitnessClient(
		witnessHostPort,
		logger
	)

	const { receipt } = await generateProviderReceipt({
		name: paramsJson.name,
		secretParams: paramsJson.secretParams,
		params: paramsJson.params,
		client,
		logger,
	})

	const transcriptStr = getTranscriptString(receipt!)
	console.log('receipt:\n', transcriptStr)

	try {
		const res = await providers[paramsJson.name].assertValidProviderReceipt(
            receipt!,
            paramsJson.params,
		)
		console.log(`receipt is valid for ${paramsJson.name} provider`)
		console.log(`extracted params: ${canonicalize(Object.keys(res?.extractedParams).length > 0 ? res.extractedParams : undefined) ?? 'none'}`)
	} catch(err) {
		console.error(`receipt is invalid for ${paramsJson.name} provider:`, err)
	}
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

export function getWitnessClient(url: string, logger: Logger) {
	const parsedUrl = new URL(url)
	if(
		parsedUrl.protocol === 'grpcs:'
        || parsedUrl.protocol === 'grpc:'
	) {
		const address = `${parsedUrl.hostname}:${parsedUrl.port || 8001}`
		const channel = niceGrpc.createChannel(address)
		return niceGrpc.createClient(
			proto.ReclaimWitnessDefinition,
			channel,
		)
	}

	return createGrpcWebClient(url, logger)
}

if(require.main === module) {
	main()
		.catch(err => {
			console.error('error in receipt gen', err)
		})
}

