import { Provider, ProviderName } from '../types'
import http from './http'

export const providers: {
	[T in ProviderName]: Provider<T>
} = {
	http,
}