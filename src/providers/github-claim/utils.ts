export const CLAIM_TYPE = [
	'github-issues',
	'github-commits',
	'github-pull-requests',
] as const

export type GithubClaimType = (typeof CLAIM_TYPE)[number]

type GithubError = {
	message: string
	documentation_url?: string
	errors?: {
		message?: string
		resource?: string
		field?: string
		code?: string
	}[]
}

type GithubSearchResponse = {
	total_count: number
	incomplete_results: boolean
	items: unknown[]
}

export const isGithubError = (error: unknown): error is GithubError => {
	return isObject(error) && error.hasOwnProperty('message')
}

export const isValidResponse = (
	responseBody: unknown
): responseBody is GithubSearchResponse => {
	return (
		isObject(responseBody) &&
		'total_count' in responseBody &&
		'incomplete_results' in responseBody &&
		'items' in responseBody &&
		typeof responseBody.total_count === 'number' &&
		typeof responseBody.incomplete_results === 'boolean' &&
		Array.isArray(responseBody.items) &&
		responseBody.items.length > 0
	)
}

export type SearchQueryObject = {
	keywords: string[]
	qualifiers: Record<string, string[]>
}

export const DEFAULT_QUERY_STRING: Record<string, string | number> = {
	// eslint-disable-next-line camelcase
	per_page: 1,
}

function githubSearchQuery(
	inputQueryObject: SearchQueryObject,
	claimType: GithubClaimType,
	repository: string
) {
	const queryObject = cloneDeep(inputQueryObject)

	const stringDigitRegex = /^[a-zA-Z0-9]+$/
	const disallowedQualifierKeys = [
		'type',
		'author',
		'user',
		'username',
		'repo',
		'committer',
		'org',
	] as const

	function validateInputQueryObject() {
		if(
			!queryObject.keywords ||
			!Array.isArray(queryObject.keywords) ||
			!queryObject.qualifiers ||
			!isObject(queryObject.qualifiers)
		) {
			throw new Error('Invalid query object')
		}

		for(const k of Object.keys(queryObject.qualifiers)) {
			const key = k.toLowerCase()
			const value = queryObject.qualifiers[key]
			if(
				!stringDigitRegex.test(key) ||
				disallowedQualifierKeys.includes(
					key as (typeof disallowedQualifierKeys)[number]
				)
			) {
				throw new Error('Invalid qualifier key')
			}

			if(
				!Array.isArray(value) ||
				!value.some((v) => stringDigitRegex.test(v.toLowerCase()))
			) {
				throw new Error('Invalid qualifier value')
			}
		}

		if(
			queryObject.keywords.length &&
			!queryObject.keywords.some((k) => stringDigitRegex.test(k.toLowerCase()))
		) {
			throw new Error('Invalid keywords')
		}
	}

	function addKeywords(keywords: SearchQueryObject['keywords']) {
		for(let keyword in keywords) {
			keyword = keyword.toLowerCase()

			if(!queryObject.keywords.includes(keyword)) {
				queryObject.keywords.push(keyword)
			}
		}
	}

	function addQualifiers(
		key: keyof SearchQueryObject['qualifiers'],
		value: SearchQueryObject['qualifiers'][number]
	) {
		key = key.toLowerCase()
		if(!queryObject.qualifiers[key]) {
			queryObject.qualifiers[key] = []
		}

		queryObject.qualifiers[key].push(...value)
	}

	function buildQuery() {
		addDefaultQualifiers()
		let query = queryObject.keywords.join(' ')

		Object.keys(queryObject.qualifiers).forEach((key) => {
			const values = queryObject.qualifiers[key]
			if(values.length > 0) {
				for(const v of values) {
					if(!query.includes(`${key}:${v}`)) {
						query += ` ${key}:${v}`
					}
				}
			}
		})
		return query.trim()
	}

	function addDefaultQualifiers() {
		switch (claimType) {
		case 'github-commits':
			addQualifiers('repo', [repository])
			addQualifiers('author', ['@me'])
			break

		case 'github-issues':
			addQualifiers('repo', [repository])
			addQualifiers('is', ['issue'])
			addQualifiers('assignee', ['@me'])
			break

		case 'github-pull-requests':
			addQualifiers('repo', [repository])
			addQualifiers('is', ['pr'])
			addQualifiers('author', ['@me'])
			break
		}
	}

	function encode() {
		const query = buildQuery()
		return encodeURIComponent(query)
	}

	validateInputQueryObject()

	return {
		addKeywords,
		addQualifiers,
		buildQuery,
		encode,
		addDefaultQualifiers,
	}
}

export const buildQueryString = (
	searchQueryObj: SearchQueryObject,
	claimType: GithubClaimType,
	defaultQueries: Record<string, number | string>,
	repository: string
) => {
	const queryString = githubSearchQuery(searchQueryObj, claimType, repository)
	const searchQueryString = queryString.encode()
	const queryParams: string[] = []

	for(const key of Object.keys(defaultQueries)) {
		const encodedKey = encodeURIComponent(key)
		const encodedValue = encodeURIComponent(defaultQueries[key])
		queryParams.push(`${encodedKey}=${encodedValue}`)
		queryParams.push(`q=${searchQueryString}`)
	}

	const queryStringResult = queryParams.join('&')
	return `?${queryStringResult}`
}

export function getGithubEndpoint(type: GithubClaimType) {
	switch (type) {
	case 'github-commits':
		return 'commits'
	case 'github-issues':
		return 'issues'
	case 'github-pull-requests':
		return 'issues'
	}
}

export function isObject(value: unknown): value is { [key: string]: any } {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
}

// hacky way to clone an object
function cloneDeep(value: any) {
	return JSON.parse(JSON.stringify(value))
}