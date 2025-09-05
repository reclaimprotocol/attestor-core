// eslint-disable-next-line simple-import-sort/imports
import '#src/external-rpc/jsc-polyfills/index.ts'

import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto'

import { handleIncomingMessage } from '#src/external-rpc/index.ts'
import { B64_JSON_REVIVER } from '#src/utils/b64-json.ts'

function readIncomingMsg(): JSCIncomingMsg {
	const cmd = readline()
	return JSON.parse(cmd, B64_JSON_REVIVER)
}

setCryptoImplementation(pureJsCrypto)

print('Input base URL for attestor')
const initCmd = readIncomingMsg()
if(initCmd.type !== 'init') {
	throw new Error('Expected init command')
}

globalThis.RPC_CHANNEL_NAME = 'cli'
globalThis.ATTESTOR_BASE_URL = initCmd.attestorBaseUrl
const channel: AttestorRPCChannel = {
	postMessage(message) {
		print(message)
	},
}

globalThis[RPC_CHANNEL_NAME] = channel

print('reading RPC messages...')

let cmd: JSCIncomingMsg
while(cmd = readIncomingMsg(), cmd.type !== 'quit') {
	if(cmd.type === 'init') {
		continue
	}

	handleIncomingMessage(cmd)
	// give 500ms to do some async work
	await new Promise((resolve) => {
		setTimeout(resolve, 500)
	})
}

print('done')