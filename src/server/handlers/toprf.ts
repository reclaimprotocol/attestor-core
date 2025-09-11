import { ethers } from 'ethers'

import type { RPCHandler } from '#src/types/index.ts'
import { getEnvVariable } from '#src/utils/env.ts'
import { getEngineString, makeDefaultOPRFOperator } from '#src/utils/index.ts'

export const toprf: RPCHandler<'toprf'> = async(
	{ maskedData, engine },
	{ logger }
) => {
	const PRIVATE_KEY_STR = getEnvVariable('TOPRF_SHARE_PRIVATE_KEY')
	const PUBLIC_KEY_STR = getEnvVariable('TOPRF_SHARE_PUBLIC_KEY')
	if(!PRIVATE_KEY_STR || !PUBLIC_KEY_STR) {
		throw new Error('private/public keys not set. Cannot execute OPRF')
	}

	const PRIVATE_KEY = ethers.utils.arrayify(PRIVATE_KEY_STR)
	const PUBLIC_KEY = ethers.utils.arrayify(PUBLIC_KEY_STR)

	const engineStr = getEngineString(engine)
	//init all algorithms
	const operator1 = makeDefaultOPRFOperator('chacha20', engineStr, logger)
	const operator2 = makeDefaultOPRFOperator('aes-128-ctr', engineStr, logger)
	const operator3 = makeDefaultOPRFOperator('aes-256-ctr', engineStr, logger)
	await operator1.evaluateOPRF(PRIVATE_KEY, maskedData, logger)
	await operator2.evaluateOPRF(PRIVATE_KEY, maskedData, logger)
	const res = await operator3.evaluateOPRF(PRIVATE_KEY, maskedData, logger)
	return { ...res, publicKeyShare: PUBLIC_KEY }
}