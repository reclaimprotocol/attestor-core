import type { Logger } from '../../types'

export type MakeTunnelBaseOpts<O> = O & {
	logger?: Logger
	onClose?(err?: Error): void
	onMessage?(data: Uint8Array): void
}

export type Tunnel<E> = E & {
	write(data: Uint8Array): void
	close(err?: Error): void
}

export type MakeTunnelFn<O, E = {}> = (opts: MakeTunnelBaseOpts<O>) => (
	Tunnel<E> | Promise<Tunnel<E>>
)

export type Transcript<T> = {
	sender: 'client' | 'server'
	message: T
}[]