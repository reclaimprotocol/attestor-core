import { resolve, setServers } from 'dns'
import { DNS_SERVERS } from 'src/config'

setDnsServers()

export async function resolveHostnames(hostname: string) {
	return new Promise<string[]>((_resolve, reject) => {
		resolve(hostname, (err, addresses) => {
			if(err) {
				reject(
					new Error(
						`Could not resolve hostname: ${hostname}, ${err.message}`
					)
				)
			} else {
				_resolve(addresses)
			}
		})
	})
}

function setDnsServers() {
	setServers(DNS_SERVERS)
}