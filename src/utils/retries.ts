import { Logger } from 'src/types'

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
			retries += 1
			if(retries >= maxRetries) {
				throw err
			}

			if(!shouldRetry(err)) {
				throw err
			}

			logger.info({ err, retries }, 'retrying failed operation')
		}
	}

	throw new Error('retries exhausted')
}