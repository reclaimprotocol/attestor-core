export function sortedStringify(obj: any[]) {
	if(obj && typeof obj === 'object') {
		if(Array.isArray(obj)) {
			return `[${obj.map(sortedStringify).join(',')}]`
		}

		return `{${Object.keys(obj).sort().map(key => `"${key}":${sortedStringify(obj[key])}`).join(',')}}`
	}

	if(typeof obj === 'string') {
		return `"${obj}"`
	}

	return String(obj)
}