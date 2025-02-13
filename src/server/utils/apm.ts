import ElasticAPM, { Agent } from 'elastic-apm-node'
import { getEnvVariable } from 'src/utils/env'
import { logger } from 'src/utils/logger'

let apm: Agent | undefined

/**
 * Initialises the APM agent if required,
 * and returns it.
 * If ELASTIC_APM_SERVER_URL & ELASTIC_APM_SECRET_TOKEN
 * are not set will return undefined
 *
 * Utilises the standard env variables mentioned
 * here: https://www.elastic.co/guide/en/apm/agent/nodejs/current/custom-stack.html#custom-stack-advanced-configuration
 */
export function getApm(): Agent | undefined {
	if(
		!getEnvVariable('ELASTIC_APM_SERVER_URL')
		|| !getEnvVariable('ELASTIC_APM_SECRET_TOKEN')
	) {
		logger.info(
			'ELASTIC_APM_SERVER_URL or ELASTIC_APM_SECRET_TOKEN not found'
			+ ' in env, APM agent not initialised'
		)
		return undefined
	}

	if(!apm) {
		const sampleRate = +(
			getEnvVariable('ELASTIC_APM_SAMPLE_RATE')
			|| '0.1'
		)
		apm = ElasticAPM.start({
			serviceName: 'reclaim_attestor',
			serviceVersion: '4.0.0',
			transactionSampleRate: sampleRate,
			instrumentIncomingHTTPRequests: true,
			usePathAsTransactionName: true,
			instrument: true,
			captureHeaders: true,
		})
		logger.info('initialised APM agent')
	}

	return apm
}

