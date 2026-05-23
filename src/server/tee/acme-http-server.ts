import { createServer, type Server } from 'http'

import { logger as LOGGER } from '#src/utils/logger.ts'

const CHALLENGE_PATH_PREFIX = '/.well-known/acme-challenge/'

/**
 * Ephemeral HTTP server that answers ACME HTTP-01 challenges. Started right
 * before an order is placed and stopped as soon as the order is finalized,
 * so the attestor does not keep port 80 bound during normal operation.
 */
export class AcmeChallengeServer {
	private readonly tokens = new Map<string, string>()
	private server?: Server

	add(token: string, keyAuthorization: string): void {
		this.tokens.set(token, keyAuthorization)
	}

	remove(token: string): void {
		this.tokens.delete(token)
	}

	async start(port: number): Promise<void> {
		if(this.server) {
			return
		}

		const server = createServer((req, res) => {
			const url = req.url ?? '/'
			if(!url.startsWith(CHALLENGE_PATH_PREFIX)) {
				res.statusCode = 404
				res.end()
				return
			}

			const token = url.slice(CHALLENGE_PATH_PREFIX.length)
			const keyAuth = this.tokens.get(token)
			if(!keyAuth) {
				res.statusCode = 404
				res.end()
				return
			}

			res.writeHead(200, { 'Content-Type': 'text/plain' })
			res.end(keyAuth)
		})

		await new Promise<void>((resolve, reject) => {
			server.once('listening', () => resolve())
			server.once('error', reject)
			server.listen(port)
		})

		LOGGER.info({ port }, 'tee: acme challenge server listening')
		this.server = server
	}

	async stop(): Promise<void> {
		const server = this.server
		if(!server) {
			return
		}

		this.server = undefined
		await new Promise<void>((resolve, reject) => {
			server.close((err) => err ? reject(err) : resolve())
		})
		LOGGER.info('tee: acme challenge server stopped')
	}
}
