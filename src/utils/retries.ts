import { Logger } from '../types'

type RetryLoopOptions = {
	maxRetries?: number
	logger: Logger
	shouldRetry: (error: Error) => boolean
}

/**
 * Execute a function, and upon failure -- retry
 * based on specified options.
 */
export async function executeWithRetries<T>(
	code: (attempt: number) => Promise<T>,
	{
		maxRetries = 3,
		shouldRetry,
		logger,
	}: RetryLoopOptions
) {
	let retries = 0
	while(retries < maxRetries) {
		try {
			const result = await code(retries)
			return result
		} catch(err) {
			if(retries >= maxRetries) {
				throw err
			}

			if(!shouldRetry(err)) {
				throw err
			}

			logger.info({ err, retries }, 'retrying failed operation')

			retries += 1
		}
	}

	throw new Error('retries exhausted')
}