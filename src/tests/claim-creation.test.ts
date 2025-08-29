import { type CipherSuite, type TLSProtocolVersion } from '@reclaimprotocol/tls'
import type { ZKEngine } from '@reclaimprotocol/zk-symmetric-crypto'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, it } from 'node:test'

import type { AttestorClient } from '#src/client/index.ts'
import { createClaimOnAttestor, getAttestorClientFromPool } from '#src/client/index.ts'
import { ClaimTunnelRequest } from '#src/proto/api.ts'
import { providers } from '#src/providers/index.ts'
import { decryptTranscript } from '#src/server/index.ts'
import { describeWithServer } from '#src/tests/describe-with-server.ts'
import { getFirstTOprfBlock, verifyNoDirectRevealLeaks } from '#src/tests/utils.ts'
import {
	assertValidClaimSignatures,
	AttestorError,
	binaryHashToStr,
	extractApplicationDataFromTranscript,
	logger,
	uint8ArrayToStr
} from '#src/utils/index.ts'

const TLS_VERSIONS: TLSProtocolVersion[] = [
	'TLS1_3',
	'TLS1_2',
]

const OPRF_CIPHER_SUITES: CipherSuite[] = [
	'TLS_CHACHA20_POLY1305_SHA256',
	'TLS_AES_256_GCM_SHA384',
	'TLS_AES_128_GCM_SHA256',
]

TLS_ADDITIONAL_ROOT_CA_LIST.push(
	readFileSync('./cert/public-cert.pem', 'utf8')
)

describeWithServer('Claim Creation', opts => {

	const zkEngine: ZKEngine = 'gnark'

	let client: AttestorClient
	let claimUrl: string
	beforeEach(() => {
		client = opts.client
		claimUrl = `https://localhost:${opts.mockhttpsServerPort}/me`

		// we need to disable certificate verification
		// for testing purposes
		providers.http.additionalClientOptions = {
			verifyServerCertificate: false
		}
	})

	for(const version of TLS_VERSIONS) {
		it(`should successfully create a claim (${version})`, async() => {
			providers.http.additionalClientOptions = {
				...providers.http.additionalClientOptions,
				supportedProtocolVersions: [version]
			}

			const user = 'adhiraj'
			const result = await createClaimOnAttestor({
				name: 'http',
				params: {
					url: claimUrl,
					method: 'GET',
					responseRedactions: [],
					responseMatches: [
						{
							type: 'contains',
							value: `${user}@mock.com`
						}
					]
				},
				secretParams: {
					authorisationHeader: `Bearer ${user}`
				},
				ownerPrivateKey: opts.privateKeyHex,
				client,
				zkEngine,
			})

			assert.ok(!result.error)
			assert.ok(result.request?.transcript)

			// decrypt the transcript and check we didn't accidentally
			// leak our secrets in the application data
			const transcript = result.request.transcript

			const applMsgs = extractApplicationDataFromTranscript(
				await decryptTranscript(
					transcript, logger, zkEngine,
					result.request?.fixedServerIV,
					result.request?.fixedClientIV
				)
			)

			const requestData = applMsgs
				.filter(m => m.sender === 'client')
				.map(m => uint8ArrayToStr(m.message))
				.join('')
			// ensure the secret authorisation header is not leaked
			assert.doesNotMatch(requestData, new RegExp(user))

			await assertValidClaimSignatures(result, client.metadata)
			// check all direct message reveals and
			// ensure we've not accidentally re-used a key
			// for multiple application data messages that
			// were not meant to be revealed.
			await verifyNoDirectRevealLeaks()
		})
	}

	it('should not create a claim with invalid response', async() => {
		await assert.rejects(
			() => createClaimOnAttestor({
				name: 'http',
				params: {
					url: claimUrl,
					method: 'GET',
					responseRedactions: [],
					responseMatches: [
						{
							type: 'contains',
							value: 'something@mock.com'
						}
					]
				},
				secretParams: {
					authorisationHeader: 'Fail'
				},
				ownerPrivateKey: opts.privateKeyHex,
				client,
				zkEngine,
			}),
			(err: AttestorError) => {
				assert.equal(err.message, 'Provider returned error 401')
				return true
			}
		)
	})

	describe('OPRF', () => {

		// OPRF is only available on gnark right now
		const zkEngine = 'gnark'

		for(const cipherSuite of OPRF_CIPHER_SUITES) {

			it('should create a claim with an OPRF redaction (%s)', async() => {
				providers.http.additionalClientOptions = {
					...providers.http.additionalClientOptions,
					cipherSuites: [cipherSuite]
				}

				const user = '(?<test>adhiraj)'
				const result = await createClaimOnAttestor({
					name: 'http',
					params: {
						url: claimUrl,
						method: 'GET',
						responseRedactions: [
							{
								regex: user,
								hash: 'oprf'
							}
						],
						responseMatches: [
							{
								type: 'contains',
								value: ''
							}
						]
					},
					secretParams: {
						authorisationHeader: `Bearer ${user}`
					},
					ownerPrivateKey: opts.privateKeyHex,
					client,
					zkEngine,
				})

				assert.ok(!result.error)
				// decrypt the transcript and check we didn't accidentally
				// leak our secrets in the application data
				const transcript = result.request?.transcript
				assert.ok(transcript)

				const applMsgs = extractApplicationDataFromTranscript(
					await decryptTranscript(
						transcript, logger, zkEngine,
						result.request?.fixedServerIV!,
						result.request?.fixedClientIV!
					)
				)

				const serverPackets = applMsgs
					.filter(m => m.sender === 'server')
					.map(m => uint8ArrayToStr(m.message))
					.join('')

				const toprf = getFirstTOprfBlock(result.request!)!
				assert.ok(toprf)

				// only the user's hash should be revealed
				assert.doesNotMatch(serverPackets, new RegExp(user))

				assert.match(
					serverPackets,
					new RegExp(binaryHashToStr(toprf.nullifier, toprf.dataLocation!.length))
				)
			})
		}

		it('should create claim with OPRF spread across multiple packets', async() => {
			const user = 'abcd_test_user'
			const result = await createClaimOnAttestor({
				name: 'http',
				params: {
					url: claimUrl + '?splitDataAcrossPackets=true',
					method: 'GET',
					responseRedactions: [
						{ regex: 'emailAddress\":\"(?<test>[a-z_]+)@', hash: 'oprf' }
					],
					responseMatches: [{ type: 'contains', value: '' }]
				},
				secretParams: {
					authorisationHeader: `Bearer ${user}`
				},
				ownerPrivateKey: opts.privateKeyHex,
				client,
				zkEngine,
			})

			assert.ok(!result.error)
			// decrypt the transcript and check we didn't accidentally
			// leak our secrets in the application data
			const transcript = result.request?.transcript
			assert.ok(transcript)

			// ensure that the transcript never contained the raw user data
			const serialisedReq = ClaimTunnelRequest.encode(result.request!).finish()
			const serialisedReqStr = uint8ArrayToStr(serialisedReq)
			assert.ok(!serialisedReqStr.includes(user))
			assert.ok(!serialisedReqStr.includes('abcd'))
			assert.ok(!serialisedReqStr.includes('test_user'))

			const applMsgs = extractApplicationDataFromTranscript(
				await decryptTranscript(
					transcript, logger, zkEngine,
					result.request?.fixedServerIV!,
					result.request?.fixedClientIV!
				)
			)

			const serverPackets = applMsgs
				.filter(m => m.sender === 'server')
				.map(m => uint8ArrayToStr(m.message))
				.join('')

			const toprf = getFirstTOprfBlock(result.request!)!
			assert.ok(toprf)

			// only the user's hash should be revealed
			assert.doesNotMatch(serverPackets, new RegExp(user))

			assert.match(
				serverPackets,
				new RegExp(binaryHashToStr(toprf.nullifier, toprf.dataLocation!.length))
			)
		})

		it('should produce the same hash for the same input', async() => {

			let hash: Uint8Array | undefined

			for(let i = 0;i < 2;i++) {
				const user = '(?<su>some-user)'
				const result = await createClaimOnAttestor({
					name: 'http',
					params: {
						url: claimUrl,
						method: 'GET',
						responseRedactions: [
							{
								regex: user,
								hash: 'oprf'
							}
						],
						responseMatches: [
							{
								type: 'contains',
								value: ''
							}
						]
					},
					secretParams: {
						authorisationHeader: `Bearer ${user}`
					},
					ownerPrivateKey: opts.privateKeyHex,
					client,
					zkEngine,
				})

				const toprf = getFirstTOprfBlock(result.request!)
				assert.ok(toprf)
				hash ||= toprf.nullifier

				assert.deepEqual(toprf.nullifier, hash)
			}
		})
	})

	describe('Pool', () => {

		it('should correctly throw error when tunnel creation fails', async() => {
			await assert.rejects(
				() => createClaimOnAttestor({
					name: 'http',
					params: {
						url: 'https://some.dns.not.exist',
						method: 'GET',
						responseRedactions: [],
						responseMatches: [
							{
								type: 'contains',
								value: 'test'
							}
						]
					},
					secretParams: {
						authorisationHeader: 'Bearer abcd'
					},
					ownerPrivateKey: opts.privateKeyHex,
					client: { url: opts.serverUrl },
					zkEngine
				}),
				(err: AttestorError) => {
					assert.match(err.message, /ENOTFOUND/)
					return true
				}
			)
		})

		it('should reconnect client when found disconnected', async() => {
			await createClaim()
			// since we're using a pool, we'll find the client
			// disconnected and when we create the claim again
			// we expect a new connection to be established
			const client = getAttestorClientFromPool(opts.serverUrl)
			await client.terminateConnection()
			// ensure claim is still successful
			const result2 = await createClaim()
			assert.ok(result2.claim)

			const client2 = getAttestorClientFromPool(opts.serverUrl)
			assert.notEqual(client2, client)
		})

		it('should retry on network errors', async() => {
			const client = getAttestorClientFromPool(opts.serverUrl)
			client.sendMessage = async() => {
				// @ts-ignore
				client.sendMessage = () => {}

				const err = new AttestorError(
					'ERROR_NETWORK_ERROR',
					'F'
				)

				await client.terminateConnection(err)
				throw err
			}

			// first the client will mock disconnection when
			// sending a message -- that should trigger a retry
			// and result in a successful claim creation
			assert.ok(await createClaim())

			// ensure new client is created to replace
			// the disconnected one
			const client2 = getAttestorClientFromPool(opts.serverUrl)
			assert.notEqual(client2, client)
		})
	})

	function createClaim() {
		const user = 'testing-123'
		return createClaimOnAttestor({
			name: 'http',
			params: {
				url: claimUrl,
				method: 'GET',
				responseRedactions: [],
				responseMatches: [
					{
						type: 'contains',
						value: `${user}@mock.com`
					}
				]
			},
			secretParams: {
				authorisationHeader: `Bearer ${user}`
			},
			ownerPrivateKey: opts.privateKeyHex,
			client: { url: opts.serverUrl }
		})
	}
})