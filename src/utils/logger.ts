import P from 'pino'

const logger = P()
const defLogLevel = process.env.NODE_ENV === 'test' ? 'debug' : 'info'
logger.level = process.env.LOG_LEVEL || defLogLevel

export default logger