import { base64 } from 'ethers/lib/utils'

export const B64_JSON_REPLACER = (key: string, value: any) => {
	if(value instanceof Uint8Array) {
		return base64.encode(value)
	}

	return value
}