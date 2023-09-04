import { createClaim, CreateClaimOptions } from '../api-client'
import { ProviderName } from '../providers'
import { CreateStep } from '../types'
import { logger } from './logger'

type IdentifiedMessage = {
	module: 'witness-sdk'
	/**
	 * Optionally, name of the channel to respond to
	 * Useful for specifying 'flutter_webview'
	 * channel
	 */
	channel?: string
	id: string
}

export type WindowRPCRequest<N extends ProviderName = any> = ({
	type: 'createClaim'
	request: CreateClaimOptions<N>
}) & IdentifiedMessage

type WindowRPCData = {
	type: 'createClaimDone'
	response: Awaited<ReturnType<typeof createClaim>>
} | {
	type: 'createClaimStep'
	step: CreateStep
} | {
	type: 'error'
	data: {
		message: string
		stack?: string
	}
}

export type WindowRPCResponse = WindowRPCData
	& IdentifiedMessage
	& { isResponse: true }

/**
 * Sets up the current window to listen for RPC requests
 * from React Native or other windows
 */
export function setupWindowRpc() {
	window.addEventListener('message', handleMessage, false)

	logger.info('window RPC setup')

	async function handleMessage(event: MessageEvent<any>) {
		let id = ''
		let channel = ''
		try {
			if(!event.data) {
				return
			}

			const req: WindowRPCRequest = typeof event.data === 'string'
				? JSON.parse(event.data)
				: event.data
			// ignore any messages not for us
			if(req.module !== 'witness-sdk') {
				return
			}

			// ignore response messages
			if('isResponse' in req && req.isResponse) {
				return
			}

			if(!req.id) {
				logger.warn(
					{ req },
					'Window RPC request missing ID'
				)
				return
			}

			logger.info(
				{ req, origin: event.origin },
				'processing RPC request'
			)

			id = req.id
			channel = req.channel || ''

			switch (req.type) {
			case 'createClaim':
				const response = await createClaim({
					...req.request,
					didUpdateCreateStep(step) {
						respond({
							type: 'createClaimStep',
							step,
						})
					},
				})
				respond({
					type: 'createClaimDone',
					response,
				})
				break
			default:
				throw new Error(`Unknown request type: ${req.type}`)
			}
		} catch(err) {
			logger.error(
				{ err, data: event.data },
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

		function respond(data: WindowRPCData) {
			const res: WindowRPCResponse = {
				...data,
				id,
				module: 'witness-sdk',
				isResponse: true
			}
			const resStr = JSON.stringify(res)
			if(channel) {
				window[channel]?.postMessage(resStr)
			} else {
				event.source!.postMessage(resStr)
			}
		}
	}
}