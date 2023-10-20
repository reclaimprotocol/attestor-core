import { wrapInHttpProvider } from '../http-provider/wrapper'
import { areValidPanCardParams } from './utils'

// params for the request that will be publicly available
// contains the rides taken by the logged in user
export type PanCardNumberParams = {
  jtoken: string
  panCardNumber: string
  deviceSecurityId: string
};

// params required to generate the http request to uber
// these would contain fields that are to be hidden from the public,
// including the witness
type PanCardNumberSecretParams = {};

const panCardNumber = wrapInHttpProvider<
  PanCardNumberParams,
  PanCardNumberSecretParams
>({
	getParams: ({
		panCardNumber,
		deviceSecurityId,
		jtoken,
	}: PanCardNumberParams) => ({
		headers: {
			'device-security-id': deviceSecurityId,
			jtoken,
		},

		url: 'https://ids.digilocker.gov.in/api/2.0/issueddocs',
		method: 'POST',
		responseRedactions: [
			{
				regex: `"uri"\s*:\s*"in.gov.pan-PANCR-${panCardNumber}"[^}]*?"doc_type_id"\s*:\s*"PANCR"`,
			},
		],
		responseMatches: [
			{
				type: 'regex',
				value: `"uri"\s*:\s*"in.gov.pan-PANCR-${panCardNumber}"[^}]*?"doc_type_id"\s*:\s*"PANCR"`,
			},
		],
	}),
	getSecretParams: () => ({
		// the provider does not require any cookie nor auth header, the secret params are in header
		cookieStr: 'cookie',
	}),
	areValidParams: areValidPanCardParams,
})

export default panCardNumber
// trackStatusForFilledApplication
