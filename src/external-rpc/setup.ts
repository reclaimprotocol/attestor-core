import type { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import { utils } from 'ethers'

import { createClaimOnAvs } from '#src/avs/client/create-claim-on-avs.ts'
import { createClaimOnAttestor } from '#src/client/index.ts'
import { benchmark } from '#src/external-rpc/benchmark.ts'
import type { CreateClaimResponse, RPCCreateClaimOptions, WindowRPCClient, WindowRPCErrorResponse, WindowRPCIncomingMsg, WindowRPCOutgoingMsg, WindowRPCResponse } from '#src/external-rpc/types.ts'
import { generateRpcRequestId, getCurrentMemoryUsage, getWsApiUrlFromBaseUrl, RPC_MSG_BRIDGE, sendMessage, waitForResponse } from '#src/external-rpc/utils.ts'
import { ALL_ENC_ALGORITHMS, makeWindowRpcOprfOperator, makeWindowRpcZkOperator } from '#src/external-rpc/zk.ts'
import { createClaimOnMechain } from '#src/mechain/client/create-claim-on-mechain.ts'
import type { ClaimTunnelResponse } from '#src/proto/api.ts'
import { extractHTMLElement, extractJSONValueIndex, generateRequstAndResponseFromTranscript } from '#src/providers/http/utils.ts'
import type { OPRFOperators, ProviderParams, ProviderSecretParams, ZKOperators } from '#src/types/index.ts'
import { B64_JSON_REVIVER } from '#src/utils/b64-json.ts'
import { AttestorError, getIdentifierFromClaimInfo, logger as LOGGER, makeLogger, uint8ArrayToStr } from '#src/utils/index.ts'

const VALID_MODULES = [
	'attestor-core',
	'witness-sdk'
]

let logger = LOGGER

/**
 * Sets up the current window to listen for RPC requests
 * from React Native or other windows
 */
export function setupWindowRpc(baseUrl?: string, channel = 'attestor-core') {
	if(baseUrl) {
		globalThis.ATTESTOR_BASE_URL = baseUrl
	} else if(typeof window !== 'undefined' && window.location) {
		globalThis.ATTESTOR_BASE_URL = window.location.toString()
	} else {
		throw new Error('No base URL provided and window.location unavailable')
	}

	if(channel) {
		globalThis.RPC_CHANNEL_NAME = channel
	} else if(!globalThis.RPC_CHANNEL_NAME) {
		throw new Error('No channel name provided and globalThis.RPC_CHANNEL_NAME unavailable')
	}

	logger = makeLogger(true)

	if(typeof window !== 'undefined') {
		window.addEventListener(
			'message',
			ev => handleIncomingMessage(ev.data),
			false
		)
	}

	logger.info({ defaultUrl: getWsApiUrlFromBaseUrl() }, 'window RPC setup')
}

export async function handleIncomingMessage(data: string | WindowRPCIncomingMsg) {
	let id = ''
	try {
		const req: WindowRPCIncomingMsg = (
			typeof data === 'string'
				? JSON.parse(data, B64_JSON_REVIVER)
				: data
		)

		id = req.id || ''

		const rslt = await _handleIncomingMessage(req)
		if(!rslt) {
			return
		}

		respond(rslt)
	} catch(err) {
		console.error('Error in RPC', { id, error: err })
		respond({
			type: 'error',
			data: {
				message: err.message,
				stack: err.stack,
			}
		})
	}

	function respond(
		data: WindowRPCResponse<WindowRPCClient, keyof WindowRPCClient>
			| WindowRPCErrorResponse
	) {
		const res = {
			...data,
			id,
			module: 'attestor-core',
			isResponse: true
		} as WindowRPCOutgoingMsg
		return sendMessage(res)
	}
}

async function _handleIncomingMessage(req: WindowRPCIncomingMsg): Promise<
	WindowRPCResponse<WindowRPCClient, keyof WindowRPCClient> | undefined
> {
	const { module, id: reqId } = req
	// ignore any messages not for us
	if(!VALID_MODULES.includes(module)) {
		return
	}

	RPC_MSG_BRIDGE.dispatch(req)
	// ignore response messages
	if(('isResponse' in req && req.isResponse)) {
		return
	}

	if(!reqId) {
		logger.warn({ req }, 'Window RPC request missing ID')
		return
	}

	logger.info({ req }, 'processing RPC request')

	switch (req.type) {
	case 'createClaim':
		const claimTunnelRes = await createClaimOnAttestor({
			...req.request,
			context: req.request.context
				? JSON.parse(req.request.context)
				: undefined,
			zkOperators: getZkOperators(
				req.request.zkOperatorMode, req.request.zkEngine
			),
			oprfOperators: getOprfOperators(
				req.request.zkOperatorMode, req.request.zkEngine
			),
			client: {
				url: getWsApiUrlFromBaseUrl(),
				authRequest: req.request.authRequest
			},
			logger,
			onStep(step) {
				sendMessage({
					type: 'createClaimStep',
					step: {
						name: req.module.includes('witness')
						// backwards compatibility
							? 'witness-progress'
							: 'attestor-progress',
						step,
					},
					module: req.module,
					id: generateRpcRequestId(),
				})
			},
			updateProviderParams : req.request.updateProviderParams
				? updateProviderParams
				: undefined
		})
		const response = mapToCreateClaimResponse(claimTunnelRes)
		return { type: 'createClaimDone', response }
	case 'createClaimOnAvs':
		const avsRes = await createClaimOnAvs({
			...req.request,
			payer: req.request.payer === 'attestor'
				? { attestor: getWsApiUrlFromBaseUrl() }
				: undefined,
			context: req.request.context
				? JSON.parse(req.request.context)
				: undefined,
			zkOperators: getZkOperators(
				req.request.zkOperatorMode, req.request.zkEngine
			),
			oprfOperators: getOprfOperators(
				req.request.zkOperatorMode, req.request.zkEngine
			),
			logger,
			onStep(step) {
				sendMessage({
					type: 'createClaimOnAvsStep',
					step,
					module: req.module,
					id: req.id,
				})
			},
		})
		return {
			type: 'createClaimOnAvsDone',
			response: avsRes,
		}
	case 'createClaimOnMechain':
		const mechainRes = await createClaimOnMechain({
			...req.request,
			context: req.request.context
				? JSON.parse(req.request.context)
				: undefined,
			zkOperators: getZkOperators(
				req.request.zkOperatorMode, req.request.zkEngine
			),
			oprfOperators: getOprfOperators(
				req.request.zkOperatorMode, req.request.zkEngine
			),
			client: {	url: getWsApiUrlFromBaseUrl() },
			logger,
			onStep(step) {
				sendMessage({
					type: 'createClaimOnMechainStep',
					step,
					module: req.module,
					id: req.id,
				})
			},
		})
		const claimResponses: CreateClaimResponse[] = []
		for(let i = 0; i < mechainRes.responses.length; i++) {
			claimResponses[i] = mapToCreateClaimResponse(mechainRes.responses[i])
		}

		return {
			type: 'createClaimOnMechainDone',
			response: { taskId: mechainRes.taskId, data: claimResponses },
		}
	case 'extractHtmlElement':
		return {
			type: 'extractHtmlElementDone',
			response: extractHTMLElement(
				req.request.html,
				req.request.xpathExpression,
				req.request.contentsOnly
			),
		}
	case 'extractJSONValueIndex':
		return {
			type: 'extractJSONValueIndexDone',
			response: extractJSONValueIndex(
				req.request.json,
				req.request.jsonPath
			),
		}
	case 'getCurrentMemoryUsage':
		return {
			type: 'getCurrentMemoryUsageDone',
			response: await getCurrentMemoryUsage(),
		}
	case 'setLogLevel':
		logger = makeLogger(
			true,
			req.request.logLevel,
			req.request.sendLogsToApp
				? (level, message) => (
					sendMessage({
						type: 'log',
						level,
						message,
						module: req.module,
						id: req.id,
					})
				)
				: undefined
		)
		return { type: 'setLogLevelDone', response: undefined }
	case 'benchmarkZK':
		return { type: 'benchmarkZKDone', response: await benchmark() }
	case 'ping':
		return { type: 'pingDone', response: { pong: new Date().toJSON() } }
	default:
		break
	}
}


function getZkOperators(
	mode: RPCCreateClaimOptions['zkOperatorMode'] = 'default',
	zkEngine: ZKEngine = 'snarkjs'
) {
// use default snarkJS ops
	if(mode === 'default') {
		return
	}

	// the native app/window calling implements
	// a ZK operator & wants to use it
	const operators: ZKOperators = {}
	for(const alg of ALL_ENC_ALGORITHMS) {
		operators[alg] = makeWindowRpcZkOperator(alg, zkEngine)
	}

	return operators
}

function getOprfOperators(
	mode: RPCCreateClaimOptions['zkOperatorMode'] = 'default',
	zkEngine: ZKEngine = 'snarkjs'
) {
// use default webview ops
	if(mode === 'default') {
		return
	}

	// the native app/window calling implements
	// a ZK operator & wants to use it
	const operators: OPRFOperators = {}
	for(const alg of ALL_ENC_ALGORITHMS) {
		operators[alg] = makeWindowRpcOprfOperator(alg, zkEngine)
	}

	return operators
}

async function updateProviderParams(
	transcript,
	tlsVersion,
): Promise<{
	params: Partial<ProviderParams<'http'>>
	secretParams: Partial<ProviderSecretParams<'http'>>
}> {
	const { req, res } = generateRequstAndResponseFromTranscript(
		transcript,
		tlsVersion
	)
	const id = generateRpcRequestId()
	const waitForRes = waitForResponse('updateProviderParams', id)
	sendMessage({
		type: 'updateProviderParams',
		id,
		request: {
			request: {
				...req,
				body: req.body
					? uint8ArrayToStr(req.body)
					: undefined
			},
			response: { ...res, body: uint8ArrayToStr(res.body) },
		},
		module: 'attestor-core'
	})
	return waitForRes
}

function mapToCreateClaimResponse(
	res: ClaimTunnelResponse
): CreateClaimResponse {
	if(!res.claim) {
		throw AttestorError.fromProto(res.error)
	}

	return {
		identifier: getIdentifierFromClaimInfo(res.claim),
		claimData: res.claim,
		witnesses: [
			{
				id: res.signatures!.attestorAddress,
				url: getWsApiUrlFromBaseUrl()
			}
		],
		signatures: [
			utils
				.hexlify(res.signatures!.claimSignature)
				.toLowerCase()
		]
	}
}