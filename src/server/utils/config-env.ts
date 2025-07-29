import { config } from 'dotenv'

import { getEnvVariable } from '#src/utils/env.ts'

const nodeEnv = getEnvVariable('NODE_ENV') || 'development'
config({ path: `.env.${nodeEnv}` })