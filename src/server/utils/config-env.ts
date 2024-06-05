import { config } from 'dotenv'
import { getEnvVariable } from '../../utils/env'

const nodeEnv = getEnvVariable('NODE_ENV') || 'development'
config({ path: `.env.${nodeEnv}` })