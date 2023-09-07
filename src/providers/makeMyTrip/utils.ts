export const buildQueryString = (url: string, obj: Record<string, string>) => {
	// for(const [k, v] of Object.entries(obj)) {
	// 	obj[k] = encodeURIComponent(JSON.stringify(v))
	// }

	const query = new URLSearchParams(obj).toString()
	if(Object.keys(obj).length === 0) {
		return url
	}

	return url + '?' + query
}

export const DEFAULT_QUERY_STRING = {

}
