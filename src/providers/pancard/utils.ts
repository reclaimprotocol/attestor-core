import { PanCardNumberParams } from '.'

export const areValidPanCardParams = (
	params: Partial<PanCardNumberParams>
): params is PanCardNumberParams => {
	return (
		Boolean(params?.panCardNumber?.length) &&
        Boolean(params?.deviceSecurityId?.length) &&
       Boolean (params?.jtoken?.length)
	)
}
