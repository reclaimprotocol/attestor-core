import { wrapInHttpProvider } from "../http-provider/wrapper"

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
    },
    url: 'https://www.binance.com/bapi/kyc/v2/private/certificate/user-kyc/current-kyc-status',
    method: 'POST',
    responseSelections: [
      {
        jsonPath: '$.data.fillInfo.dob',
        responseMatch: `\"dob\":\"${dateOfBirth}\"`,
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
