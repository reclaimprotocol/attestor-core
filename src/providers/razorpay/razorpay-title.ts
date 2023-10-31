import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the username of the logged in user and x-csrf-token
type RazorpayTitle = {
	title: string
    csrfToken: string

}

// params required to generate the http request to Razorpay
// these would contain fields that are to be hidden from the public,
// including the witness
type RazorpaySecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const razorpayTitle = wrapInHttpProvider({
	getParams: ({ title, csrfToken }: RazorpayTitle) => (
		{
			headers: {
				'csrf': csrfToken,
			},
			url: 'https://payroll.razorpay.com/v2/api/me',
			method: 'GET',
			responseSelections: [
				{
					'jsonPath': '$.currentOrganization.employeeDetails.title',
					'responseMatch': `\"title\":\"${title}\"`
				}
			],
		}
	),
	getSecretParams: ({ cookieStr }: RazorpaySecretParams) => ({
		cookieStr: cookieStr
	}),
	areValidParams: (params): params is RazorpayTitle => {
		return (
			typeof params.title === 'string' && typeof params.csrfToken === 'string'
		)
	}
})

export default razorpayTitle


