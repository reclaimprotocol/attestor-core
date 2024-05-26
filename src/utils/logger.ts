import P from 'pino'

export const logger = P()
logger.level = process.env.LOG_LEVEL || 'info'