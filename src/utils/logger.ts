import P from 'pino'
import { Logger } from '../types'

const localLogger = P({ formatters: {
	log: (line) => {
		return redact(line)
	},
} })


export const logger = makeLogger('info')

function makeLogger(level: string): Logger {
	localLogger.level = level
	return localLogger
}

export function setLogLevel(level: keyof typeof logger) {
	localLogger.level = level
	return true
}

function isObjectProperty(property) {
	return (typeof property) === 'object' && !Array.isArray(property) && property !== null
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


const properties = ['ownerPrivateKey', 'secretParams']
const redactedText = '[REDACTED]'

function redact(json) {
	const isObject = isObjectProperty(json)

	if(!isObject && !Array.isArray(json)) {
		return json
	}

	const redacted = JSON.parse(JSON.stringify(json, getReplacer()))

	for(const prop in redacted) {
		if(properties.includes(prop)) {
			redacted[prop] = redactedText
		}

		if(Array.isArray(redacted[prop])) {
			redacted[prop].forEach((value, index) => {
				redacted[prop][index] = redact(value)
			})
		} else if(isObjectProperty(redacted[prop])) {
			redacted[prop] = redact(redacted[prop])
		}
	}

	return redacted
}
