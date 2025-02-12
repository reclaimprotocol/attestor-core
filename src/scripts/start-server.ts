import { getApm } from 'src/server/utils/apm'
import 'src/server/utils/config-env'
getApm()

function main() {
	// importing dynamically to allow APM to inject
	// into modules before they are used
	const { createServer } = require('../server/create-server')
	return createServer()
}

main()