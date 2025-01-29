import { makeTLSClient } from '@reclaimprotocol/tls'
import { verifyCertificateChain } from '@reclaimprotocol/tls/lib/utils/parse-certificate'
import { Socket } from 'net'
import { DEFAULT_HTTPS_PORT } from 'src/config'
import { logger } from 'src/utils'

const hostPort = process.argv[2]

export async function main() {
	const [host, port] = hostPort.split(':')
	const socket = new Socket()
	let rootIssuer = ''
	let certError: Error | undefined
	const tls = makeTLSClient({
		host,
		logger,
		verifyServerCertificate: false,
		async onRecvCertificates({ certificates }) {
			rootIssuer = certificates[certificates.length - 1].internal.issuer
			logger.info({ rootIssuer }, 'received certificates')
			try {
				await verifyCertificateChain(certificates, host)
				logger.info('root CA in store. Successfully verified certificate chain')
			} catch(err) {
				certError = err
			}
		},
		async onHandshake() {
			await tls.end()
			socket.end()

			if(certError) {
				// wait for everything else to log
				setTimeout(
					() => {
						logger.info(
							{ err: certError!.message, rootIssuer },
							'error in cert verify'
						)
					},
					500
				)
			}
		},
		async write({ header, content }) {
			socket.write(header)
			socket.write(content)
		}
	})

	socket.once('connect', () => tls.startHandshake())
	socket.on('data', tls.handleReceivedBytes)

	logger.info(`connecting to ${hostPort}`)

	socket.connect({ host, port: +(port || DEFAULT_HTTPS_PORT) })
}

void main()