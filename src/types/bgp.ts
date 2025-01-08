
export type BGPAnnouncementOverlapData = {
	prefix: string
}

export type BGPListener = {
	/**
	 * Add an IP to listen for overlap,
	 * @returns a function to remove the IP from the listener
	 */
	onOverlap(
		ips: string[],
		callback: (event: BGPAnnouncementOverlapData) => void
	): (() => void)

	close(): void
}