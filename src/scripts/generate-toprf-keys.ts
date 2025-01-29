import { ethers } from 'ethers'
import { logger, makeDefaultOPRFOperator } from 'src/utils'

const ENGINE = 'gnark'
const TOTAL_KEYS = 10
const THRESHOLD = 1

async function main() {
	const op = makeDefaultOPRFOperator('chacha20', ENGINE, logger)
	const {
		publicKey,
		privateKey,
		shares
	} = await op.generateThresholdKeys(TOTAL_KEYS, THRESHOLD)
	logEnvValue('TOPRF_PUBLIC_KEY', publicKey)
	logEnvValue('TOPRF_PRIVATE_KEY', privateKey)

	for(const [i, share] of shares.entries()) {
		console.log(`# Share ${i}`)
		logEnvValue('TOPRF_SHARE_PUBLIC_KEY', share.publicKey)
		logEnvValue('TOPRF_SHARE_PRIVATE_KEY', share.privateKey)
	}
}

function logEnvValue(name: string, value: Uint8Array) {
	console.log(`${name}=${ethers.utils.hexlify(value)}`)
}

void main()