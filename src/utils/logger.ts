import P, { LoggerOptions } from 'pino'
import type { LogLevel } from 'src/types'
import { getEnvVariable } from 'src/utils/env'

const PII_PROPERTIES = ['ownerPrivateKey', 'secretParams']
const redactedText = '[REDACTED]'
const envLevel = getEnvVariable('LOG_LEVEL') as LogLevel

export let logger = P()

makeLogger(false, envLevel)

/**
 * Creates a logger instance with optional redaction of PII.
 * Replaces default logger
 * See PII_PROPERTIES for the list of properties that will be redacted.
 *
 * @param redactPii - whether to redact PII from logs
 * @param level - the log level to use
 * @param onLog - a callback to call when a log is written
 */
export function makeLogger(
	redactPii: boolean,
	level?: LogLevel,
	onLog?: (level: LogLevel, log: any) => void
) {
	const opts: LoggerOptions = {
		// Log human readable time stamps instead of epoch time
		timestamp: P.stdTimeFunctions.isoTime,
	}
	if(redactPii) {
		opts.formatters = { log: redact }
		opts.serializers = { redact }
		opts.browser = {
			write: {
				fatal: log => writeLog('fatal', log),
				error: log => writeLog('error', log),
				warn: log => writeLog('warn', log),
				info: log => writeLog('info', log),
				debug: log => writeLog('debug', log),
				trace: log => writeLog('trace', log),
			}
		}
	}

	const pLogger = P(opts)
	pLogger.level = level || 'info'

	logger = pLogger
	return pLogger

	function writeLog(level: LogLevel, log: any) {
		log = redact(log)
		const { msg, ...obj } = log
		if(console[level]) {
			console[level](obj, msg)
		} else {
			console.log(obj, msg)
		}

		onLog?.(level, log)
	}
}

function isObjectProperty(property) {
	return (typeof property) === 'object'
		&& !Array.isArray(property)
		&& property !== null
}

function getReplacer() {
	// Store references to previously visited objects
	const references = new WeakSet()

	return function(key, value) {
		const isObject = (typeof value) === 'object' && value !== null
		if(isObject) {
			if(references.has(value)) {
				return '[CIRCULAR]'
			}

			references.add(value)
		}

		return value
	}
}

export function redact(json) {
	const isObject = isObjectProperty(json)

	if(!isObject && !Array.isArray(json)) {
		return json
	}

	const redacted = JSON.parse(JSON.stringify(json, getReplacer()))

	for(const prop in redacted) {
		if(PII_PROPERTIES.includes(prop)) {
			redacted[prop] = redactedText
		}

		if(Array.isArray(redacted[prop])) {
			for(const [index, value] of redacted[prop].entries()) {
				redacted[prop][index] = redact(value)
			}
		} else if(isObjectProperty(redacted[prop])) {
			redacted[prop] = redact(redacted[prop])
		}
	}

	return redacted
}
