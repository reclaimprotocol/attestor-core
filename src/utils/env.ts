export type TransportType = 'node' | 'react-native' | 'browser'

export function detectEnvironment(): TransportType {
	if(typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
		return 'react-native'
	}

	if(typeof window !== 'undefined') {
		return 'browser'
	}

	return 'node'
}