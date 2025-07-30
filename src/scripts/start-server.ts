import '#src/server/utils/config-env.ts'

import { getApm } from '#src/server/utils/apm.ts'
getApm()

async function main() {
	// importing dynamically to allow APM to inject
	// into modules before they are used
	const { createServer } = await import('#src/server/index.ts')
	return createServer()
}

main()