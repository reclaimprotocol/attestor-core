import http from 'src/providers/http'
import httpb64 from 'src/providers/httpb64'
import { Provider, ProviderName } from 'src/types'

export const providers: {
	[T in ProviderName]: Provider<T>
} = {
	http,
	httpb64
}