import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the rides taken by the logged in user
type UberRides = {
	rides: string
}

// params required to generate the http request to uber
// these would contain fields that are to be hidden from the public,
// including the witness
type UberSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const uberRides = wrapInHttpProvider<UberRides, UberSecretParams>({
	getParams: ({ rides }: UberRides) => (
		{
			headers: {
				'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
				'content-type': 'application/json',
				'x-csrf-token': 'x',
			},
			url: 'https://riders.uber.com/graphql',
			method: 'POST',
			responseSelections: [
				{
					'jsonPath': '$.data.getTrips.count',
					'responseMatch': `\"count\":${rides}`
				}
			],
			body: JSON.stringify({
				operationName: 'GetTrips',
				variables: {
					cursor: '',
					fromTime: null,
					toTime: null
				  },
				query: 'query GetTrips($cursor: String, $fromTime: Float, $toTime: Float){\ngetTrips(cursor: $cursor, fromTime: $fromTime, toTime: $toTime) {\ncount\n__typename\n}\n}\n'
			})
		}
	),
	getSecretParams: ({ cookieStr }: UberSecretParams) => ({
		cookieStr: cookieStr
	}),
	areValidParams: (params): params is UberRides => {
		return (
			typeof params.rides === 'string'
		)
	}
})

export default uberRides


