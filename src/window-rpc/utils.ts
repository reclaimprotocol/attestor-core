
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
			const result = await performance.measureUserAgentSpecificMemory()
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