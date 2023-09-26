import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the username of the logged in user and x-csrf-token
type KaggleUsername = {
	username: string
    csrfToken: string

}

// params required to generate the http request to Kaggle
// these would contain fields that are to be hidden from the public,
// including the witness
type KaggleSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const kaggleUsername = wrapInHttpProvider({
	getParams: ({ username, csrfToken }: KaggleUsername) => (
		{
			headers: {
				'x-xsrf-token': csrfToken,
			},
			url: 'https://www.kaggle.com/api/i/users.UsersService/GetCurrentUser',
			method: 'POST',
			responseSelections: [
				{
					'jsonPath': '$.userName',
					'responseMatch': `\"userName\":\"${username}\"`
				}
			],
			body: JSON.stringify({
				includeGroups:false,
				includeLogins:false
			})
		}
	),
	getSecretParams: ({ cookieStr }: KaggleSecretParams) => ({
		cookieStr: cookieStr
	}),
	areValidParams: (params): params is KaggleUsername => {
		return (
			typeof params.username === 'string' && typeof params.csrfToken === 'string'
		)
	}
})

export default kaggleUsername


