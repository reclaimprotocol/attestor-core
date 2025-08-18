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
	const operator = makeDefaultOPRFOperator('chacha20', engineStr, logger)
	const res = await operator.evaluateOPRF(PRIVATE_KEY, maskedData)

	return { ...res, publicKeyShare: PUBLIC_KEY }
}