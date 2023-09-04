import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the userId of the logged in user
type YCombinatorLoginParams = {
	userId: number
}

// params required to generate the http request to YC
// these would contain fields that are to be hidden from the public,
// including the witness
type YCombinatorLoginSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const YCombinatorLogin = wrapInHttpProvider({
	getParams: ({ userId }: YCombinatorLoginParams) => (
		{
			url: 'https://bookface.ycombinator.com/home',
			method: 'GET',
			responseSelections: [
				{
					'jsonPath': '$.currentUser',
					'xPath': "//*[@id='js-react-on-rails-context']",
					'responseMatch': `{\"id\":${userId},.*?waas_admin.*?:{.*?}.*?:{.*?}.*?(?:full_name|first_name).*?}`
				}
			]
		}
	),
	getSecretParams: ({ cookieStr }: YCombinatorLoginSecretParams) => ({
		cookieStr
	}),
	areValidParams: (params): params is YCombinatorLoginParams => {
		const userId = +(params.userId || '')
		return (
			!Number.isNaN(userId)
			&& userId > 0
		)
	}
})

export default YCombinatorLogin