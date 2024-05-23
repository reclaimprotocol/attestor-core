import P from 'pino'
import { Logger } from '../types'

const localLogger = P()
export const logger = makeLogger('info')

function makeLogger(level: string): Logger {
	localLogger.level = level
	return localLogger
}

export function setLogLevel(level: keyof typeof logger) {
	localLogger.level = level
	return true
}

