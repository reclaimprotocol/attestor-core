import assert from 'node:assert'
import { beforeEach, it } from 'node:test'

import { AttestorClient } from '#src/client/index.ts'
import { describeWithServer } from '#src/tests/describe-with-server.ts'
import { AttestorError, logger } from '#src/utils/index.ts'

describeWithServer('RPC Communication', opts => {

	const { getClientOnServer } = opts

	let client: AttestorClient
	beforeEach(() => {
		client = opts.client
	})

	it('should successfully initialise a session', async() => {
		await client.waitForInit()
		assert.ok(client.isInitialised)
		// ensure the server has our client
		assert.ok(getClientOnServer())
	})

	it('should gracefully handle terminated connection during init', async() => {
		await client.terminateConnection()
		client = new AttestorClient({
			logger,
			// a URL without a WS server
			url: `ws://localhost:${opts.mockhttpsServerPort}`
		})
		await assert.rejects(
			() => client.waitForInit(),
			err => {
				assert.ok(err instanceof AttestorError)
				assert.strictEqual(err.code, 'ERROR_NETWORK_ERROR')
				return true
			}
		)
	})

	it('should gracefully handle connection termination', async() => {
		const err = new AttestorError(
			'ERROR_INTERNAL',
			'Test error',
			{ abcd: 1 }
		)
		const waitForEnd = new Promise<AttestorError>(resolve => {
			client.addEventListener('connection-terminated', d => {
				resolve(d.data)
			})
		})

		const ws = getClientOnServer()!
		await ws.terminateConnection(err)
		const recvErr = await waitForEnd
		assert.deepEqual(recvErr, err)
		assert.ok(!client.isOpen)
	})

	it('should terminate connection to server', async() => {
		const ws = getClientOnServer()!
		const waitForEnd = new Promise<AttestorError>(resolve => {
			ws.addEventListener('connection-terminated', d => {
				resolve(d.data)
			})
		})

		await client.terminateConnection()
		await waitForEnd
	})

	it('should handle RPC error response', async() => {
		const err = new AttestorError(
			'ERROR_INTERNAL',
			'Test error',
			{ abcd: 1 }
		)

		const ws = getClientOnServer()!
		ws.addEventListener('rpc-request', ev => {
			ev.stopImmediatePropagation()
			ev.data.respond(err)
		})

		await assert.rejects(
			() => client.rpc(
				'createTunnel',
				{
					host: 'localhost',
					port: 9999,
				}
			),
			recvErr => {
				assert.partialDeepStrictEqual(recvErr, err)
				return true
			}
		)
	})
})