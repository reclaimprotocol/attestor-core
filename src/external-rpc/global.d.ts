declare module globalThis {
	var ATTESTOR_BASE_URL: string
	var RPC_CHANNEL_NAME: string

	interface Performance {
		measureUserAgentSpecificMemory(): { bytes: number }
	}

	interface AttestorRPCChannel {
		postMessage(message: string): void
	}

	/**
	 * https://github.com/sindresorhus/type-fest/blob/main/source/distributed-omit.d.ts
	 */
	type DistributedOmit<ObjectType, KeyType extends KeysOfUnion<ObjectType>> =
		ObjectType extends unknown
			? Omit<ObjectType, KeyType>
			: never;
}