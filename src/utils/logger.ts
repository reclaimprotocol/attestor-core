import P from 'pino'
import { Logger } from '../types'

const localLogger = P()
export const logger = makeLogger(process.env.LOG_LEVEL || 'info')

function makeLogger(level: string): Logger {
	localLogger.level = level
	return localLogger
}

export function setLogLevel(level: keyof typeof logger) {
	localLogger.level = level
	return true
}

