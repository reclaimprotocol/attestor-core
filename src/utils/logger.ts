import P from 'pino'
import { getEnvVariable } from './env'

export const logger = P()
logger.level = getEnvVariable('LOG_LEVEL') || 'info'