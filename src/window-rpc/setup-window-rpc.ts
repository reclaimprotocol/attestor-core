import { createClaimOnWitness } from '../create-claim'
import { extractHTMLElement, extractJSONValueIndex } from '../providers/http-provider/utils'
import { ZKOperators } from '../types'
import { logger, setLogLevel } from '../utils'
import { CommunicationBridge, RPCCreateClaimOptions, WindowRPCClient, WindowRPCErrorResponse, WindowRPCIncomingMsg, WindowRPCOutgoingMsg, WindowRPCResponse } from './types'
import { getCurrentMemoryUsage, getWsApiUrlFromLocation } from './utils'
import { ALL_ENC_ALGORITHMS, makeWindowRpcZkOperator } from './window-rpc-zk'


class RPCEvent extends Event {
	constructor(public readonly data: WindowRPCIncomingMsg) {
		super('message')
	}
}

/**
 * Sets up the current window to listen for RPC requests
 * from React Native or other windows
 */
export function setupWindowRpc() {
	window.addEventListener('message', handleMessage, false)
	const windowMsgs = new EventTarget()

	const defaultWitnessUrl = getWsApiUrlFromLocation()

	logger.info({ defaultWitnessUrl }, 'window RPC setup')

	async function handleMessage(event: MessageEvent<any>) {
		let id = ''
		let channel = ''
		try {
			if(!event.data) {
				return
			}

			const req: WindowRPCIncomingMsg = typeof event.data === 'string'
				? JSON.parse(event.data)
				: event.data
			// ignore any messages not for us
			if(req.module !== 'witness-sdk') {
				return
			}

			id = req.id
			channel = req.channel || ''

			windowMsgs.dispatchEvent(new RPCEvent(req))
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
				const response = await createClaimOnWitness({
					...req.request,
					zkOperators: getZkOperators(
						req.request.zkOperatorMode
					),
					client: { url: defaultWitnessUrl },
					logger,
					onStep(step) {
						sendMessage({
							type: 'createClaimStep',
							step: {
								name: 'witness-progress',
								step,
							},
							module: 'witness-sdk',
							id: req.id,
						})
					},
				})
				respond({
					type: 'createClaimDone',
					response,
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
					response: extractJSONValueIndex(req.request.json, req.request.jsonPath),
				})
				break
			case 'getCurrentMemoryUsage':
				respond({
					type: 'getCurrentMemoryUsageDone',
					response: await getCurrentMemoryUsage(),
				})
				break
			case 'setLogLevel':
				respond({
					type: 'setLogLevelDone',
					response: setLogLevel(req.request.logLevel)
				})
				break
			default:
				break
			}
		} catch(err) {
			logger.error({ err, data: event.data }, 'error in RPC')
			respond({
				type: 'error',
				data: {
					message: err.message,
					stack: err.stack,
				}
			})
		}

		function getZkOperators(
			zkOperatorMode: RPCCreateClaimOptions['zkOperatorMode']
			= 'default'
		) {
			// use default snarkJS ops
			if(zkOperatorMode === 'default') {
				return
			}

			// the native app/window calling implements
			// a ZK operator & wants to use it
			const operators: ZKOperators = {}
			for(const alg of ALL_ENC_ALGORITHMS) {
				operators[alg] = makeWindowRpcZkOperator(
					alg,
					makeCommunicationBridge()
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

					function handle(msg: RPCEvent) {
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
				module: 'witness-sdk',
				isResponse: true
			} as WindowRPCOutgoingMsg
			return sendMessage(res)
		}

		function sendMessage(data: WindowRPCOutgoingMsg) {
			const str = JSON.stringify(data)
			if(channel) {
				window[channel]?.postMessage(str)
			} else {
				event.source!.postMessage(str)
			}
		}
	}
}