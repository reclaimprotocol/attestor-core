export const buildQueryString = (url: string, obj: Record<string, string>) => {


	const query = new URLSearchParams(obj).toString()
	if(Object.keys(obj).length === 0) {
		return url
	}

	return url + '?' + query
}

export const DEFAULT_QUERY_STRING = {
	'page_number': '0',
	'page_size': '6',
}
