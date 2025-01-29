import { readdir, readFile, writeFile } from 'fs/promises'
import { compile } from 'json-schema-to-typescript'
import { parse } from 'yaml'

const PROVIDER_SCHEMAS_PATH = './provider-schemas'
const GEN_TS_FILENAME = './src/types/providers.gen.ts'
const BinaryDataType = 'BinaryData'

async function main() {
	const folders = await findAllProviderFolders()

	console.log(`Generating for ${folders.length} provider folders`)

	let ts = '/* eslint-disable */\n/* Generated file. Do not edit */'
	// json-schema nor ajv support uint8array formats,
	// so we define a custom type for binary data
	// and use it in the generated types
	ts += `\n\ntype ${BinaryDataType} = Uint8Array | string\n`
	// type map of each provider to its parameters and secret parameters
	let providerTypeMap = '\nexport interface ProvidersConfig {\n'
	// schema map of each provider to its parameters and secret parameters
	// storing the JSON schema in the map
	// lets us validate the parameters and secret parameters
	let providerSchemaMap = '\nexport const PROVIDER_SCHEMAS = {\n'

	for(const folder of folders) {
		const {
			schemaTitle: paramsSchemaTitle,
			ts: paramsSchemaTs,
			jsonTitle: paramsJsonTitle
		} = await generateTsFromYamlSchema(folder, 'parameters')
		const {
			schemaTitle: secretParamsSchemaTitle,
			ts: secretParamsSchemaTs,
			jsonTitle: secretParamsJsonTitle
		} = await generateTsFromYamlSchema(
			folder,
			'secret-parameters'
		)

		ts += `\n${paramsSchemaTs}\n${secretParamsSchemaTs}`
		providerTypeMap += `	${folder}: {\n`
		providerTypeMap += `		parameters: ${paramsSchemaTitle}\n`
		providerTypeMap += `		secretParameters: ${secretParamsSchemaTitle}\n`
		providerTypeMap += '	}\n'

		providerSchemaMap += `	${folder}: {\n`
		providerSchemaMap += `		parameters: ${paramsJsonTitle},\n`
		providerSchemaMap += `		secretParameters: ${secretParamsJsonTitle}\n`
		providerSchemaMap += '	},\n'
	}

	providerTypeMap += '}\n'
	providerSchemaMap += '}\n'
	ts += providerTypeMap
	ts += providerSchemaMap

	await writeFile(GEN_TS_FILENAME, ts)
	console.log(`Wrote to ${GEN_TS_FILENAME}`)
}

async function getJsonSchemaForProvider(
	name: string,
	type: 'parameters' | 'secret-parameters'
) {
	const paramsYaml = await readFile(
		`${PROVIDER_SCHEMAS_PATH}/${name}/${type}.yaml`,
		{ encoding: 'utf-8' }
	)
	const paramsJson = parse(paramsYaml)
	return paramsJson
}

export async function generateTsFromYamlSchema(
	name: string,
	type: 'parameters' | 'secret-parameters'
) {
	const paramsJson = await getJsonSchemaForProvider(name, type)
	let paramsSchemaTs = await compile(
		paramsJson,
		'',
		{
			additionalProperties: false,
			bannerComment: '',
			ignoreMinAndMaxItems: true,
			declareExternallyReferenced: false,
			customName({ type, format }) {
				if(type === 'string' && format === 'binary') {
					return BinaryDataType
				}

				return undefined
			},
		}
	)

	const jsonTitle = `${paramsJson.title}Json`
	paramsSchemaTs += `\nexport const ${jsonTitle} = ${JSON.stringify(paramsJson)}`

	return {
		ts: paramsSchemaTs,
		schemaTitle: paramsJson.title,
		jsonTitle
	}
}

/**
 * Find all provider folders in the provider-schemas directory
 * @returns {Promise<string[]>} List of provider folder names
 */
async function findAllProviderFolders() {
	const providerFolders = await readdir(
		PROVIDER_SCHEMAS_PATH,
		{ withFileTypes: true }
	)
	return providerFolders
		.filter(p => p.isDirectory())
		.map(p => p.name)
}

void main()