import { base64 } from 'ethers/lib/utils'
import { InitRequest, ServiceSignatureType, WitnessVersion } from '../../proto/api'
import { SIGNATURES } from '../../signatures'
import { logger as LOGGER } from '../../utils'
import { MakeWitnessClientOptions } from '../types'

const VERSION = WitnessVersion.WITNESS_VERSION_2_0_0

export function makeReclaimClient({
	privateKeyHex,
	url,
	signatureType = ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH,
	logger = LOGGER
}: MakeWitnessClientOptions) {
	const {
		getAddress,
		getPublicKey,
	} = SIGNATURES[signatureType]
	const pubKey = getPublicKey(privateKeyHex)
	const address = getAddress(pubKey)

	const initRequest: InitRequest = {
		userId: address,
		signatureType,
		clientVersion: VERSION
	}
	const initRequestBytes = InitRequest.encode(initRequest).finish()
	const initRequestB64 = base64.encode(initRequestBytes)

	url = new URL(url.toString())
	url.searchParams.set('initRequest', initRequestB64)

	const ws = new WebSocket(url.toString())
	ws.logger = logger
	ws.binaryType = 'arraybuffer'
	ws.metadata = initRequest
	ws.startProcessingRpcMessages()

	return ws
}