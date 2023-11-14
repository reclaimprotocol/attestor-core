import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the username of the logged in user and x-csrf-token
type CartaEsops = {
	count: number
	userId: string
}

// params required to generate the http request to Kaggle
// these would contain fields that are to be hidden from the public,
// including the witness
type CartaSecretParams = {
	/** cookie string for authentication */
	cookieStr: string
}

const cartaEsopsCount = wrapInHttpProvider({
	getParams: ({ count, userId }: CartaEsops) => (
		{
			headers: {
				'accept': 'application/json, text/plain, */*',
				'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8'
			},
			url: `https://app.carta.com/api/investors/portfolio/fund/${userId}/list/`,
			method: 'GET',
			responseSelections: [
				{
					'jsonPath': '$.count',
					'responseMatch': `\"count\":${count}`
				}
			]
		}
	),
	getSecretParams: ({ cookieStr }: CartaSecretParams) => ({
		cookieStr: cookieStr
	}),
	areValidParams: (params): params is CartaEsops => {
		return (
			typeof params.count === 'number' && typeof params.userId === 'string'
		)
	}
})

export default cartaEsopsCount


