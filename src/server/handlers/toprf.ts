import { ethers } from 'ethers'
import { TOPRF_GENERATOR } from 'src/server/utils/toprf'
import { RPCHandler } from 'src/types'
import { getEnvVariable } from 'src/utils/env'

export const toprfRequest: RPCHandler<'toprf'> = async({ maskedData }) => {
	const PRIVATE_KEY_STR = getEnvVariable('TOPRF_PRIVATE_KEY')
	if(!PRIVATE_KEY_STR) {
		throw new Error('TOPRF_PRIVATE_KEY not set. Cannot execute OPRF')
	}

	const PRIVATE_KEY = ethers.utils.arrayify(PRIVATE_KEY_STR)


	const res = await TOPRF_GENERATOR.evaluateOPRF(PRIVATE_KEY, maskedData)
	return res
}