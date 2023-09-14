import { config } from 'dotenv'
config()

import { readFile } from 'fs/promises'
import { createGrpcWebClient, generateProviderReceipt, getTranscriptString, logger, ProviderName, ProviderParams, providers, ProviderSecretParams } from '..'

export type ProviderReceiptGenerationParams<P extends ProviderName> = {
	name: P
	params: ProviderParams<P>
	secretParams: ProviderSecretParams<P>
}

const DEFAULT_WITNESS_HOST_PORT = 'https://reclaim-node.questbook.app'

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

	const client = await createGrpcWebClient(
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

	const transcriptStr = getTranscriptString(receipt!.transcript)
	console.log('receipt:\n', transcriptStr)

	try {
		await providers[paramsJson.name].assertValidProviderReceipt(
			receipt!,
			paramsJson.params,
		)
		console.log(`receipt is valid for ${paramsJson.name} provider`)
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

if(require.main === module) {
	main()
		.catch(err => {
			console.error('error in receipt gen', err)
		})
}

