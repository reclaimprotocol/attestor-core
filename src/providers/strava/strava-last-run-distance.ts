import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the username of the logged in user and x-csrf-token
type StravaLastRunDistance = {
	distance: string
}

// params required to generate the http request to Kaggle
// these would contain fields that are to be hidden from the public,
// including the witness
type StravaLastRunDistanceSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const stravaLastRunDistance = wrapInHttpProvider({
	getParams: ({ distance }: StravaLastRunDistance) => (
		{
			headers: {
				'x-requested-with': 'XMLHttpRequest',
			},
			url: 'https://www.strava.com/athlete/training_activities?activity_type=Run',
			method: 'GET',
			responseSelections: [
				{
					'jsonPath': '$.models[0].distance',
					'responseMatch': `\"distance\":\"${distance}\"`
				}
			],
		}
	),
	getSecretParams: ({ cookieStr }: StravaLastRunDistanceSecretParams) => ({
		cookieStr: cookieStr
	}),
	areValidParams: (params): params is StravaLastRunDistance => {
		return (
			typeof params.distance === 'string'
		)
	}
})

export default stravaLastRunDistance


