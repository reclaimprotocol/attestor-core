import { ethers } from 'ethers'
import { WS_PATHNAME } from 'src/config'
import { ClaimTunnelResponse } from 'src/proto/api'
import { AttestorError, getIdentifierFromClaimInfo } from 'src/utils'
import { CommunicationBridge, CreateClaimResponse, WindowRPCAppClient } from 'src/window-rpc/types'

// track memory usage
export async function getCurrentMemoryUsage() {
	if(!window.crossOriginIsolated) {
		return {
			available: false,
			content: 'N/A (page not cross-origin-isolated)'
		}
	} else if(!performance.measureUserAgentSpecificMemory) {
		return {
			available: false,
			content: 'N/A (performance.measureUserAgentSpecificMemory() is not available)',
		}
	} else {
		try {
			const result = performance.measureUserAgentSpecificMemory()
			const totalmb = Math.round(result.bytes / 1024 / 1024)

			return {
				available: true,
				content: `${totalmb}mb`,
			}
		} catch(error) {
			if(error instanceof DOMException && error.name === 'SecurityError') {
				return {
					available: false,
					content: `N/A (${error.message})`,
				}
			}

			throw error
		}
	}
}

export function generateRpcRequestId() {
	return Math.random().toString(36).slice(2)
}

/**
 * The window RPC will be served from the same origin as the API server.
 * so we can get the API server's origin from the location.
 */
export function getWsApiUrlFromLocation() {
	const { host, protocol } = location
	const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
	return `${wsProtocol}//${host}${WS_PATHNAME}`
}

export function mapToCreateClaimResponse(
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
				url: getWsApiUrlFromLocation()
			}
		],
		signatures: [
			ethers.utils
				.hexlify(res.signatures!.claimSignature)
				.toLowerCase()
		]
	}
}

export function waitForResponse<T extends keyof WindowRPCAppClient>(
	type: T,
	requestId: string,
	bridge: CommunicationBridge,
	timeoutMs = 60_000
) {
	type R = Awaited<ReturnType<WindowRPCAppClient[T]>>
	const returnType = `${type}Done` as const
	return new Promise<R>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(
				new AttestorError(
					'ERROR_INTERNAL',
					`Timeout waiting for response: ${type}`,
					{ requestId }
				)
			)
			cancel()
		}, timeoutMs)

		const cancel = bridge.onMessage(msg => {
			if(msg.id !== requestId) {
				return
			}

			if(msg.type === 'error') {
				reject(new Error(msg.data.message))
			} else if(msg.type === returnType) {
				resolve(msg.response as R)
			} else {
				return
			}

			clearTimeout(timeout)
			cancel()
		})
	})
}