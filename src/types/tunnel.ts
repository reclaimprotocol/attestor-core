import type { CreateTunnelRequest } from 'src/proto/api'

export type MakeTunnelBaseOpts<O> = O & {
	onClose?(err?: Error): void
	onMessage?(data: Uint8Array): void
}

export type Tunnel<E> = E & {
	write(data: Uint8Array): void | Promise<void>
	close(err?: Error): void | Promise<void>
}

export type MakeTunnelFn<O, E = {}> = (opts: MakeTunnelBaseOpts<O>) => (
	Tunnel<E> | Promise<Tunnel<E>>
)

export type Transcript<T> = {
	sender: 'client' | 'server'
	message: T
}[]

export type TCPSocketProperties = {
	transcript: Transcript<Uint8Array>
	createRequest: Pick<CreateTunnelRequest, 'host' | 'port' | 'geoLocation'>
}