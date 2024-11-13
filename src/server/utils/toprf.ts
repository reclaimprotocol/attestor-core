import { makeGnarkOPRFOperator, makeLocalFileFetch } from '@reclaimprotocol/zk-symmetric-crypto'

export const TOPRF_GENERATOR = makeGnarkOPRFOperator({
	fetcher: makeLocalFileFetch(),
	// algorith doesn't matter for validating OPRF requests
	algorithm: 'chacha20'
})