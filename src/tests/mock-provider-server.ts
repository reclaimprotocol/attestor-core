/**
 * Mock HTTPS server to implement the "mock-login" provider
 */
import { readFileSync } from 'fs'
import { createServer } from 'https'
import { logger } from 'src/utils'

/**
 * Mock https server to test claim creation.
 * It implements a GET /me endpoint that returns the email address
 * of the user. A bearer token is expected in the Authorization header.
 *
 * The bearer token is expected to be the email address without the domain.
 * Eg. to claim the email address "abcd@mock.com", the header
 * should be "Authorization: Bearer abcd".
 */
export function createMockServer(port: number) {
	const tlsSessionStore: Record<string, Buffer> = {}

	const server = createServer(
		{
			key: readFileSync('./cert/private-key.pem'),
			cert: readFileSync('./cert/public-cert.pem'),
		}
	)

	server.on('request', (req, res) => {
		if(req.method !== 'GET') {
			endWithError(405, 'invalid method')
			return
		}

		if(!req.url?.startsWith('/me')) {
			endWithError(404, 'invalid path')
			return
		}

		const auth = req.headers.authorization
		if(!auth) {
			endWithError(401, 'missing authorization header')
			return
		}

		if(!auth?.startsWith('Bearer ')) {
			endWithError(401, 'invalid authorization header')
			return
		}

		const emailAddress = auth.slice('Bearer '.length) + '@mock.com'
		endWithJson(200, { emailAddress })

		logger.info({ emailAddress }, 'ended with success')

		function endWithError(status: number, message: string) {
			endWithJson(status, { error: message })

			logger.info({ status, message }, 'ended with error')
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		function endWithJson(status: number, json: any) {
			const str = JSON.stringify(json)
			res.writeHead(status, {
				'Content-Type': 'application/json',
				'Content-Length': str.length.toString(),
			})
			res.write(str)
			res.end()
		}
	})

	server.listen(port)

	return { server, tlsSessionStore }
}