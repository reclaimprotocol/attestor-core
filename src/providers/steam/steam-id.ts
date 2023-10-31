import { wrapInHttpProvider } from '../http-provider/wrapper'

// params for the request that will be publicly available
// contains the steam id of the logged in user
type SteamIdParams = {
  steamId: string
}

// params required to generate the http request to Steam
// these would contain fields that are to be hidden from the public,
// including the witness
type SteamIdSecretParams = {
  /** cookie string for authentication */
  cookieStr: string
}

const steamId = wrapInHttpProvider({
  getParams: ({ steamId }: SteamIdParams) => ({
    headers: {
      'content-type': 'text/html; charset=UTF-8'
    },
    url: 'https://store.steampowered.com/account/',
    method: 'GET',
    responseRedactions:[
      {
       regex: "Steam ID: (\d+)<",
      }
    ],
    responseSelections: [
      {
        responseMatch: `Steam ID: ${steamId}<`
      }
    ]
  }),
  getSecretParams: ({ cookieStr }: SteamIdSecretParams) => ({
    cookieStr: cookieStr
  }),
  areValidParams: (params): params is SteamIdParams => {
    return typeof params.steamId === 'string'
  }
})

export default steamId
