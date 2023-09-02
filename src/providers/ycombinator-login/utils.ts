type HasBookfaceNodeObjectType = {
	[key: string]: string | number | boolean | Object

	// this field specifies whether the user has
	// access to bookface
	hasBookface: boolean
}

type UserInfoNodeObjectType = {
	[key: string]: string | number | boolean | Object

	// this field contain the details of the current logged in user
	currentUser: {
		id: number
		first_name: string
		full_name: string
	}
}

/**
 * Parse the html response for the ycombinator provider
 * Note: the classes may seem arbitrary,
 * but they are the only way to select the correct nodes
 */


export function parseResponse(html: string) {

	const hasBookfaceObject = parseHasBookfaceNode(html)
	const userInfoObject = parseUserInfoNode(html)

	return {
		hasBookfaceObject,
		userInfoObject
	}
}

function parseHasBookfaceNode(html: string): HasBookfaceNodeObjectType {
	const matches = [...html.matchAll(/"hasBookface":true/g)].map(value => value.index)

	if(matches.length !== 1) {
		throw new Error('Invalid login')
	}


	return { hasBookface: true }
}

const userRegexp = /\{"id":\d+.*?waas_admin.*?:{.*?}.*?:\{.*?}.*?(?:full_name|first_name).*?}/g

function parseUserInfoNode(html: string): UserInfoNodeObjectType {
	const matches = html.match(userRegexp)

	if(matches?.length !== 1) {
		throw new Error('Invalid login')
	}

	const userObj = JSON.parse(matches[0])

	return { currentUser: userObj }
}
