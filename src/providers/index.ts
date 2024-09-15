import http from 'src/providers/http'
import { Provider, ProviderName } from 'src/types'

export const providers: {
	[T in ProviderName]: Provider<T>
} = {
	http,
}