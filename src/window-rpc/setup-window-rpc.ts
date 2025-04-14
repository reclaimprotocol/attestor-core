import { uint8ArrayToStr } from '@reclaimprotocol/tls'
import { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import { createClaimOnAvs } from 'src/avs/client/create-claim-on-avs'
import { createClaimOnAttestor } from 'src/client'
import { createClaimOnMechain } from 'src/mechain/client/create-claim-on-mechain'
import { extractHTMLElement, extractJSONValueIndex, generateRequstAndResponseFromTranscript } from 'src/providers/http/utils'
import { OPRFOperators, ProviderParams, ProviderSecretParams, ZKOperators } from 'src/types'
import { logger as LOGGER, makeLogger } from 'src/utils'
import { B64_JSON_REPLACER, B64_JSON_REVIVER } from 'src/utils/b64-json'
import { Benchmark } from 'src/utils/benchmark'
import { CommunicationBridge, CreateClaimResponse, RPCCreateClaimOptions, WindowRPCClient, WindowRPCErrorResponse, WindowRPCIncomingMsg, WindowRPCOutgoingMsg, WindowRPCResponse } from 'src/window-rpc/types'
import { generateRpcRequestId, getCurrentMemoryUsage, getWsApiUrlFromLocation, mapToCreateClaimResponse, waitForResponse } from 'src/window-rpc/utils'
import { ALL_ENC_ALGORITHMS, makeWindowRpcOprfOperator, makeWindowRpcZkOperator } from 'src/window-rpc/window-rpc-zk'

class WindowRPCEvent extends Event {
	constructor(public readonly data: WindowRPCIncomingMsg) {
		super('message')
	}
}

const VALID_MODULES = [
	'attestor-core',
	'witness-sdk'
]

let logger = LOGGER

/**
 * Sets up the current window to listen for RPC requests
 * from React Native or other windows
 */
export function setupWindowRpc() {
	logger = makeLogger(true)

	window.addEventListener('message', handleMessage, false)
	const windowMsgs = new EventTarget()

	const defaultUrl = getWsApiUrlFromLocation()

	logger.info({ defaultUrl }, 'window RPC setup')

	async function handleMessage(event: MessageEvent<any>) {
		let id = ''
		let channel = ''
		try {
			if(!event.data) {
				return
			}

			const req: WindowRPCIncomingMsg = (
				typeof event.data === 'string'
					? JSON.parse(event.data, B64_JSON_REVIVER)
					: event.data
			)

			logger.debug({ req, origin: event.origin }, 'recv RPC message')

			// ignore any messages not for us
			if(!VALID_MODULES.includes(req.module)) {
				return
			}

			id = req.id
			channel = req.channel || ''

			windowMsgs.dispatchEvent(new WindowRPCEvent(req))
			// ignore response messages
			if(('isResponse' in req && req.isResponse)) {
				return
			}

			if(!req.id) {
				logger.warn({ req }, 'Window RPC request missing ID')
				return
			}

			logger.info(
				{ req, origin: event.origin },
				'processing RPC request'
			)

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
						url: defaultUrl,
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
							id: req.id,
						})
					},
					updateProviderParams : req.request.updateProviderParams
						? updateProviderParams
						: undefined
				})
				const response = mapToCreateClaimResponse(
					claimTunnelRes
				)
				respond({
					type: 'createClaimDone',
					response,
				})
				break
			case 'createClaimOnAvs':
				const avsRes = await createClaimOnAvs({
					...req.request,
					payer: req.request.payer === 'attestor'
						? { attestor: defaultUrl }
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
				respond({
					type: 'createClaimOnAvsDone',
					response: avsRes,
				})
				break
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
					client: {
						url: defaultUrl,
					},
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

				respond({
					type: 'createClaimOnMechainDone',
					response: { taskId: mechainRes.taskId, data: claimResponses },
				})
				break
			case 'extractHtmlElement':
				respond({
					type: 'extractHtmlElementDone',
					response: extractHTMLElement(
						req.request.html,
						req.request.xpathExpression,
						req.request.contentsOnly
					),
				})

				break
			case 'extractJSONValueIndex':
				respond({
					type: 'extractJSONValueIndexDone',
					response: extractJSONValueIndex(
						req.request.json,
						req.request.jsonPath
					),
				})
				break
			case 'getCurrentMemoryUsage':
				respond({
					type: 'getCurrentMemoryUsageDone',
					response: await getCurrentMemoryUsage(),
				})
				break
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
				respond({
					type: 'setLogLevelDone',
					response: undefined
				})
				break
			case 'benchmarkZK':
				respond({
					type: 'benchmarkZKDone',
					response: await Benchmark(),
				})
				break
			default:
				break
			}
		} catch(err) {
			logger.error(
				{ msg: err.message, err, data: event.data },
				'error in RPC'
			)
			respond({
				type: 'error',
				data: {
					message: err.message,
					stack: err.stack,
				}
			})
		}

		function getZkOperators(
			mode: RPCCreateClaimOptions['zkOperatorMode']
			= 'default',
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
				operators[alg] = makeWindowRpcZkOperator(
					alg,
					makeCommunicationBridge(),
					zkEngine
				)
			}

			return operators
		}

		function getOprfOperators(
			mode: RPCCreateClaimOptions['zkOperatorMode']
			= 'default',
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
				operators[alg] = makeWindowRpcOprfOperator(
					alg,
					makeCommunicationBridge(),
					zkEngine
				)
			}

			return operators
		}

		function makeCommunicationBridge(): CommunicationBridge {
			return {
				send: sendMessage,
				onMessage(cb) {
					windowMsgs.addEventListener('message', handle)

					return () => {
						windowMsgs.removeEventListener(
							'message',
							handle
						)
					}

					function handle(msg: WindowRPCEvent) {
						cb(msg.data)
					}
				},
			}
		}

		function respond<K extends keyof WindowRPCClient>(
			data: WindowRPCResponse<WindowRPCClient, K>
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

		function sendMessage(data: WindowRPCOutgoingMsg) {
			const str = JSON.stringify(data, B64_JSON_REPLACER)
			if(channel) {
				window[channel]?.postMessage(str)
			} else {
				event.source!.postMessage(str)
			}
		}

		async function updateProviderParams(transcript, tlsVersion): Promise<{
			params: Partial<ProviderParams<'http'>>
			secretParams: Partial<ProviderSecretParams<'http'>>
		}> {
			const { req, res } = generateRequstAndResponseFromTranscript(
				transcript,
				tlsVersion
			)
			const bridge = makeCommunicationBridge()
			const id = generateRpcRequestId()
			const waitForRes = waitForResponse('updateProviderParams', id, bridge)
			bridge.send({
				type: 'updateProviderParams',
				id,
				request: {
					request: {
						...req,
						body: req.body
							? uint8ArrayToStr(req.body)
							: undefined
					},
					response: { ...res, body:  uint8ArrayToStr(res.body) },
				},
				module: 'attestor-core'
			})
			return await waitForRes
		}
	}
}