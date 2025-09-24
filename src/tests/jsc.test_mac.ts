/**
 * This file tests that if the TLS library works on javascript
 * core (jsc) environment.
 * 1. Ensure you have the jsc binary installed
 * 2. Ensure you have built the jsc file via `npm run build:jsc`
 */
import { asciiToUint8Array } from '@reclaimprotocol/tls'
import { makeLocalFileFetch } from '@reclaimprotocol/zk-symmetric-crypto'
import { initGnark } from '@reclaimprotocol/zk-symmetric-crypto/gnark'
import { exec } from 'child_process'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { stderr, stdout } from 'process'
import type { WebSocketServer } from 'ws'

import { generateRpcRequestId } from '#src/external-rpc/utils.ts'
import { ALL_ENC_ALGORITHMS } from '#src/external-rpc/zk.ts'
import { createServer } from '#src/server/create-server.ts'
import { getRandomPort, randomPrivateKey } from '#src/tests/utils.ts'
import { B64_JSON_REPLACER, B64_JSON_REVIVER } from '#src/utils/b64-json.ts'
import { uint8ArrayToBinaryStr } from '#src/utils/generics.ts'
import { logger } from '#src/utils/logger.ts'
import { makeDefaultZkOperator } from '#src/utils/zk.ts'

// algorithm doesn't matter, as the JSC bridge handles that part internally
// we'll just initialise all of them now
for(const alg of ALL_ENC_ALGORITHMS) {
	await initGnark(alg, makeLocalFileFetch(), logger)
}

const GNARK_ZK = makeDefaultZkOperator('chacha20', 'gnark', logger)

describe('JSC Test', () => {

	let wsServer: WebSocketServer
	let privateKeyHex: string
	const wsServerPort = getRandomPort()

	let bridge: Awaited<ReturnType<typeof runJscBridge>>

	before(async() => {
		wsServer = await createServer(wsServerPort)
	})

	after(async() => {
		wsServer.close()
	})

	beforeEach(async() => {
		privateKeyHex = randomPrivateKey()
		bridge = await runJscBridge(
			{ attestorBaseUrl: `http://localhost:${wsServerPort}` }
		)
	})

	afterEach(() => {
		bridge?.exit()
	})

	it('should create claim with RPC', async() => {
		const result = await bridge.rpc({
			type: 'createClaim',
			id: generateRpcRequestId(),
			request: {
				name: 'http',
				params: {
					url: 'https://the-internet.herokuapp.com/status_codes/201',
					method: 'GET',
					responseMatches: [{
						type: 'contains',
						value: 'Status Codes',
					}],
					responseRedactions: [{
						xPath: '/html/body/div[2]/div/div/h3',
					}],
					headers: {
						accept: 'application/json, text/plain, */*'
					}
				},
				secretParams: {
					cookieStr: '<cookie-str>'
				},
				ownerPrivateKey: privateKeyHex,
				zkEngine: 'gnark',
				zkOperatorMode: 'rpc'
			}
		})
		console.log('Claim created:', result)
	})
})

async function runJscBridge(
	init: {
		attestorBaseUrl: string
	},
) {
	const wsMap: Record<string, WebSocket> = {}
	const pendingRpcMap: Record<
		string, (data: JSCOutgoingMsg) => void
	> = {}

	const prc = exec('jsc -x out/jsc-cli-rpc.mjs', { })
	prc.stdout!.on('data', async(data) => {
		const cmds = Array.from(tryReadCmds(data))
		if(!cmds.length) {
			stdout.write('[JSC] ')
			stdout.write(data)
			return
		}

		for(const cmd of cmds) {
			let res: JSCIncomingMsg
			try {
				const rslt = await handleCmd(cmd)
				if(!rslt) {
					return
				}

				res = {
					type: `${cmd.type}Done`,
					id: cmd.id,
					module: 'attestor-core',
					isResponse: true,
					response: rslt,
				} as any
			} catch(err) {
				res = {
					type: 'error',
					isResponse: true,
					id: cmd.id,
					data: {
						message: err.message,
						stack: err.stack,
					}
				}
			}

			await writeCmd(res)
		}
	})
	prc.stderr!.on('data', (data) => {
		stderr.write('[JSC-ERR] ')
		stderr.write(data)
	})

	prc.on('exit', (err) => {
		console.error('Error in JSC process', err)
	})

	await writeCmd({ type: 'init', ...init })

	return {
		writeCmd,
		rpc,
		exit() {
			prc.kill()
			onExit()
		}
	}

	function onExit() {
		for(const [id, ws] of Object.entries(wsMap)) {
			ws.close()
			delete wsMap[id]
		}

		for(const [id, resolve] of Object.entries(pendingRpcMap)) {
			resolve({
				type: 'error',
				id,
				isResponse: true,
				data: {
					message: 'Bridge closed before response',
					stack: ''
				}
			})
			delete pendingRpcMap[id]
		}
	}

	async function handleCmd(cmd: JSCOutgoingMsg) {
		if(pendingRpcMap[cmd.id]) {
			const resolve = pendingRpcMap[cmd.id]
			delete pendingRpcMap[cmd.id]
			resolve(cmd)
			return
		}

		if(cmd.type === 'connectWs') {
			const { request: { id, url } } = cmd
			const ws = (wsMap[id] = new WebSocket(url))
			ws.binaryType = 'arraybuffer'
			await new Promise<void>((resolve, reject) => {
				ws.onopen = () => resolve()
				ws.onerror = (ev) => reject(ev['error'] || ev)
			})

			ws.onclose = async() => {
				await writeCmd({
					type: 'disconnectWs',
					id: generateRpcRequestId(),
					request: { id }
				})
				delete wsMap[id]
			}

			ws.onmessage = async(ev) => {
				const data = typeof ev.data === 'string'
					? ev.data
					: new Uint8Array(ev.data)
				await writeCmd({
					type: 'sendWsMessage',
					id: generateRpcRequestId(),
					request: { id, data }
				})
			}

			return {}
		}

		if(cmd.type === 'sendWsMessage') {
			const { request: { id, data } } = cmd
			const ws = wsMap[id]
			if(!ws) {
				throw new Error(`WebSocket with id ${id} not found`)
			}

			ws.send(data)
			return {}
		}

		if(cmd.type === 'executeZkFunctionV3') {
			const { request: { fn, args } } = cmd
			// @ts-expect-error
			const result = await GNARK_ZK[fn]!(...args)
			return result
		}

		if(cmd.type === 'createClaimStep') {
			return
		}

		throw new Error(`Unknown command: ${cmd.type}`)
	}

	async function rpc<T>(cmd: JSCIncomingMsg) {
		if(!('id' in cmd)) {
			throw new Error('RPC command must have an id')
		}

		const waitForRes = new Promise<T>((resolve, reject) => {
			pendingRpcMap[cmd.id] = data => {
				if(data.type === 'error') {
					reject(new Error(data.data.message))
					return
				}

				resolve(data['response'] as T)
			}
		})
		await writeCmd(cmd)

		return waitForRes
	}

	function writeCmd(cmd: JSCIncomingMsg) {
		const cmdStr = JSON.stringify(cmd, B64_JSON_REPLACER)
		return new Promise<void>((resolve, reject) => {
			prc.stdin!.write(asciiToUint8Array(cmdStr + '\n'), (err) => {
				if(err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})
	}
}

function *tryReadCmds(str: string | Uint8Array): Generator<JSCOutgoingMsg> {
	str = typeof str === 'string' ? str : uint8ArrayToBinaryStr(str)
	const lines = str.split('\n')
	for(const line of lines) {
		try {
			const cmd = JSON.parse(line, B64_JSON_REVIVER)
			if(
				typeof cmd !== 'object'
				|| !cmd.type
				|| cmd.module !== 'attestor-core'
			) {
				continue
			}

			yield cmd as JSCOutgoingMsg
		} catch{}
	}
}