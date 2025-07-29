import { utils } from 'ethers'

export const B64_JSON_REPLACER = (key: string, value: any) => {
	if(
		value instanceof Uint8Array
		|| (
			typeof value === 'object'
			&& value
			&& 'buffer' in value
			&& value.buffer instanceof ArrayBuffer
		)
	) {
		return { type: 'uint8array', value: utils.base64.encode(value) }
	}

	return value
}

export const B64_JSON_REVIVER = (key: string, value: any) => {
	if(value?.type === 'uint8array') {
		return utils.base64.decode(value.value)
	}

	return value
}