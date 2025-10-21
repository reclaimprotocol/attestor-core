
import type { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import { utils } from 'ethers'

import { createClaimOnAvs } from '#src/avs/client/create-claim-on-avs.ts'
import { createClaimOnAttestor } from '#src/client/index.ts'
import { benchmark } from '#src/external-rpc/benchmark.ts'
import type { CreateClaimResponse, ExternalRPCClient, ExternalRPCErrorResponse, ExternalRPCIncomingMsg, ExternalRPCOutgoingMsg, ExternalRPCResponse, RPCCreateClaimOptions } from '#src/external-rpc/types.ts'
import { generateRpcRequestId, getCurrentMemoryUsage, getWsApiUrlFromBaseUrl, RPC_MSG_BRIDGE, sendMessageToApp, waitForResponse } from '#src/external-rpc/utils.ts'
import { ALL_ENC_ALGORITHMS, makeExternalRpcOprfOperator, makeExternalRpcZkOperator } from '#src/external-rpc/zk.ts'
import { createClaimOnMechain } from '#src/mechain/client/create-claim-on-mechain.ts'
import type { ClaimTunnelResponse } from '#src/proto/api.ts'
import { extractHTMLElement, extractJSONValueIndex, generateRequstAndResponseFromTranscript } from '#src/providers/http/utils.ts'
import type { OPRFOperators, ProviderParams, ProviderSecretParams, ZKOperators } from '#src/types/index.ts'
import { B64_JSON_REVIVER } from '#src/utils/b64-json.ts'
import { AttestorError, getIdentifierFromClaimInfo, logger, makeLogger, uint8ArrayToStr } from '#src/utils/index.ts'

export async function handleIncomingMessage(data: string | ExternalRPCIncomingMsg) {
	let id = ''
	try {
		const req: ExternalRPCIncomingMsg = (
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
		data: ExternalRPCResponse<ExternalRPCClient, keyof ExternalRPCClient>
			| ExternalRPCErrorResponse
	) {
		const res = {
			...data,
			id,
			isResponse: true
		} as ExternalRPCOutgoingMsg
		return sendMessageToApp(res)
	}
}

async function _handleIncomingMessage(req: ExternalRPCIncomingMsg): Promise<
	ExternalRPCResponse<ExternalRPCClient, keyof ExternalRPCClient> | undefined
> {
	const { id: reqId, type: reqType } = req
	// ignore any messages not for us
	if(!reqId || !reqType) {
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
				sendMessageToApp({
					type: 'createClaimStep',
					step: { name: 'attestor-progress', step },
					id: req.id,
				})
			},
			updateProviderParams : req.request.updateProviderParams
				? updateProviderParams
				: undefined,
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
				sendMessageToApp({
					type: 'createClaimOnAvsStep',
					step,
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
				sendMessageToApp({
					type: 'createClaimOnMechainStep',
					step,
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
		makeLogger(
			true,
			req.request.logLevel,
			req.request.sendLogsToApp
				? (level, message) => (
					sendMessageToApp({
						type: 'log',
						level,
						message,
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
		operators[alg] = makeExternalRpcZkOperator(alg, zkEngine)
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
		operators[alg] = makeExternalRpcOprfOperator(alg, zkEngine)
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
	sendMessageToApp({
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
		}
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