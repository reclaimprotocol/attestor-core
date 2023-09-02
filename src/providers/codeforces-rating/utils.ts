type HasCodeforcesPersonalSidebarType = {
	[key: string]: string | number | boolean | Object

	// this field specifies whether the user has
	// a personal sidebar - only present if logged in and is rated.
	hasPersonalSidebar: boolean
}

type UserInfoNodeObjectType = {
	[key: string]: number

	// this field contain the details of the current logged in user
	rating: number
}

/**
 * Parse the html response for the ycombinator provider
 * Note: the classes may seem arbitrary,
 * but they are the only way to select the correct nodes
 */


export function parseResponse(html: string) {

	const hasPersonalSidebarObject = parseHasCodeforcesPersonalSidebar(html)
	const userRatingInfoObject = parseUserInfoNode(html)

	return {
		hasPersonalSidebarObject,
		userRatingInfoObject
	}
}

function parseHasCodeforcesPersonalSidebar(html: string): HasCodeforcesPersonalSidebarType {
	const matches = [...html.matchAll(/<div class="personal-sidebar">/g)].map(value => value.index)

	// console.log(matches);
	if(matches.length === 0) {
		throw new Error('Invalid login or an Unrated account')
	}


	return { hasPersonalSidebar: true }
}

const userRegexp = /<div class="personal-sidebar">\n.*\n.*\n.*Rating:.*>(\d*)<\/span>/g

function parseUserInfoNode(html: string): UserInfoNodeObjectType {
	const matches = html.replace(/\r\n/g, '\n').match(userRegexp)
	const matchstrA = matches?.[0].match(/Rating.*<\/span>/g)
	const matchstrB = matchstrA?.[0].match(/>\d*<\//g)
	const matchstrC = matchstrB?.[0].split('<')
	const matchstrD = matchstrC?.[0].split('>')
	const matchstrE = matchstrD?.[1]
	const rating = Number(matchstrE)

	return { rating: rating }
}