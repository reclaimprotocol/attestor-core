import http from '#src/providers/http/index.ts'
import type { Provider, ProviderName } from '#src/types/index.ts'

export const providers: {
	[T in ProviderName]: Provider<T>
} = {
	http,
}