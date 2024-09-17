import Ajv, { ValidateFunction } from 'ajv'
import { ProviderName, ProviderParams } from 'src/types'
import { PROVIDER_SCHEMAS } from 'src/types/providers.gen'
import { AttestorError } from 'src/utils/error'

const PROVIDER_VALIDATOR_MAP: { [N in ProviderName]?: ValidateFunction } = {}

const AJV = new Ajv({
	allErrors: true,
	strict: true,
	strictRequired: false,
	formats: {
		binary(data: unknown) {
			return data instanceof Uint8Array
				|| (
					typeof Buffer !== 'undefined'
					&& Buffer.isBuffer(data)
				)
		},
		url(data: unknown) {
			try {
				new URL(data as string)
				return true
			} catch{
				return false
			}
		}
	}
})

export function assertValidateProviderParams<T extends ProviderName>(
	name: T,
	params: unknown
): asserts params is ProviderParams<T> {
	let validate = PROVIDER_VALIDATOR_MAP[name]
	if(!validate) {
		const schema = PROVIDER_SCHEMAS[name]?.parameters
		if(!schema) {
			throw new AttestorError(
				'ERROR_BAD_REQUEST',
				`Invalid provider name "${name}"`
			)
		}

		validate = AJV.compile(schema)
	}

	if(!validate(params)) {
		throw new AttestorError(
			'ERROR_BAD_REQUEST',
			'Params validation failed',
			{ errors: JSON.stringify(validate.errors) }
		)
	}
}