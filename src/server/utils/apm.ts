import ElasticAPM, { Agent } from 'elastic-apm-node'
import { getEnvVariable } from '../../utils/env'
import { logger } from '../../utils/logger'

let apm: Agent | undefined

/**
 * Initialises the APM agent if required,
 * and returns it.
 *
 * Utilises the standard env variables mentioned
 * here: https://www.elastic.co/guide/en/apm/agent/nodejs/current/custom-stack.html#custom-stack-advanced-configuration
 */
export function getApm() {
	if(!apm) {
		const sampleRate = +(
			getEnvVariable('ELASTIC_APM_SAMPLE_RATE')
			|| '0.1'
		)
		apm = ElasticAPM.start({
			serviceName: 'reclaim_witness',
			serviceVersion: '2.0.0',
			transactionSampleRate: sampleRate,
			instrumentIncomingHTTPRequests: false,
			instrument: true,
		})
		logger.info('initialised APM agent')
	}

	return apm
}

