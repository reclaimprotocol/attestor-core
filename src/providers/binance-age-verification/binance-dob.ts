import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the DOB of the logged in user and x-csrf-token
type BinanceDOB = {
    dateOfBirth: string
    csrfToken: string
}

// params required to generate the http request to binance
// these would contain fields that are to be hidden from the public,
// including the witness
type BinanceDOBSecretParams = {
    /** cookie string for authentication */
    cookieStr: string
}


const binanceDOB = wrapInHttpProvider({
	getParams: ({ dateOfBirth, csrfToken }: BinanceDOB) => (
		{
			headers: {
				'clienttype': 'web',
				'content-type': 'application/json',
				'csrftoken': csrfToken,
				'user-agent': ' Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
			},
			url: 'https://www.binance.com/bapi/kyc/v2/private/certificate/user-kyc/current-kyc-status',
			method: 'POST',
			responseRedactions: [{
				regex: '"dob":"\\d{4}-\\d{2}-\\d{2}","postalCode":"'
			}],
			responseMatches: [
				{
					type: 'regex',
					value: `\"dob\":\"${dateOfBirth}\"`
				},
			],
		}),

	getSecretParams: ({ cookieStr }: BinanceDOBSecretParams) => ({
		cookieStr: cookieStr,
	}),
	areValidParams: (params): params is BinanceDOB => {
		return (
			typeof params.dateOfBirth === 'string' &&
            typeof params.csrfToken === 'string'
		)
	},
})

export default binanceDOB
