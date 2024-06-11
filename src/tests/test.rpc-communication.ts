import { WebSocket } from 'ws'
import { WitnessClient } from '../client'
import { logger, WitnessError } from '../utils'
import { describeWithServer } from './describe-with-server'

describeWithServer('RPC Communication', opts => {

	const { getClientOnServer } = opts

	let client: WitnessClient
	beforeEach(() => {
		client = opts.client
	})

	it('should successfully initialise a session', async() => {
		await expect(client.waitForInit()).resolves.toBeUndefined()
		expect(client.isInitialised).toBe(true)
		// ensure the server has our client
		expect(getClientOnServer()).toBeTruthy()
	})

	it('should gracefully handle terminated connection during init', async() => {
		await client.terminateConnection()
		client = new WitnessClient({
			logger,
			// a URL without a WS server
			url: `ws://localhost:${opts.mockhttpsServerPort}`
		})
		await expect(client.waitForInit()).rejects.toHaveProperty('code')
	})

	it('should gracefully handle connection termination', async() => {
		const err = new WitnessError(
			'WITNESS_ERROR_INTERNAL',
			'Test error',
			{ abcd: 1 }
		)
		const waitForEnd = new Promise<WitnessError>(resolve => {
			client.addEventListener('connection-terminated', d => {
				resolve(d.data)
			})
		})

		const ws = getClientOnServer()!
		await ws.terminateConnection(err)
		const recvErr = await waitForEnd
		expect(recvErr).toEqual(err)
		expect(client.isOpen).not.toBe(WebSocket.OPEN)
	})

	it('should terminate connection to server', async() => {
		const ws = getClientOnServer()!
		const waitForEnd = new Promise<WitnessError>(resolve => {
			ws.addEventListener('connection-terminated', d => {
				resolve(d.data)
			})
		})

		await client.terminateConnection()
		await waitForEnd
	})

	it('should handle RPC error response', async() => {
		const err = new WitnessError(
			'WITNESS_ERROR_INTERNAL',
			'Test error',
			{ abcd: 1 }
		)

		const ws = getClientOnServer()!
		ws.addEventListener('rpc-request', ev => {
			ev.stopImmediatePropagation()
			ev.data.respond(err)
		})

		await expect(
			client.rpc(
				'createTunnel',
				{
					host: 'localhost',
					port: 9999,
				}
			)
		).rejects.toMatchObject(err)
	})
})