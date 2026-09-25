import { decodeBase64, encodeBase64 } from 'ethers'

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
		return { type: 'uint8array', value: encodeBase64(value) }
	}

	return value
}

export const B64_JSON_REVIVER = (key: string, value: any) => {
	if(value?.type === 'uint8array') {
		return decodeBase64(value.value)
	}

	return value
}