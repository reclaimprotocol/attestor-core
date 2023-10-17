import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the username of the logged in user and x-csrf-token
type StravaLastRun = {
	distance: string
    shortUnit: string
    startDateLocalRaw: number
    elapsedTime: string
}

// params required to generate the http request to Strava
// these would contain fields that are to be hidden from the public,
// including the witness
type StravaLastRunSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const stravaLastRun = wrapInHttpProvider({
	getParams: ({ distance, shortUnit, startDateLocalRaw, elapsedTime }: StravaLastRun) => (
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
				},
				{
					'jsonPath': '$.models[0].short_unit',
					'responseMatch': `\"short_unit\":\"${shortUnit}\"`
				},
				{
					'jsonPath': '$.models[0].start_date_local_raw',
					'responseMatch': `\"start_date_local_raw\":${startDateLocalRaw}`
				},
				{
					'jsonPath': '$.models[0].elapsed_time',
					'responseMatch': `\"elapsed_time\":\"${elapsedTime}\"`
				},
			],
		}
	),
	getSecretParams: ({ cookieStr }: StravaLastRunSecretParams) => ({
		cookieStr: cookieStr
	}),
	areValidParams: (params): params is StravaLastRun => {
		return (
			typeof params.distance === 'string' && typeof params.startDateLocalRaw === 'number' && typeof params.elapsedTime === 'string' && typeof params.shortUnit === 'string'
		)
	}
})

export default stravaLastRun


