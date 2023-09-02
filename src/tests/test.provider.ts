import { BeaconState, createSignDataForClaim } from '@reclaimprotocol/crypto-sdk'
import { createChannel, createClient } from 'nice-grpc'
import { createClaim, generateProviderReceipt } from '../api-client'
import { makeBeacon } from '../beacon'
import { ReclaimWitnessDefinition } from '../proto/api'
import { makeGrpcServer } from '../server/make-grpc-server'
import { SelectedServiceSignature } from '../signatures'
import { unixTimestampSeconds } from '../utils'
import { makeOwnerProof } from '../utils/beacon'
import { createMockServer } from './mock-provider-server'
import { MOCK_BEACON_STATE_FN } from './mocks'
import { randomPrivateKey } from './utils'

const MOCK_APP_NAME = 'mock-login'
const MOCK_PARAMS = JSON.stringify({ emailAddress: 'adhiraj@mock.com' })

describe('Provider Tests', () => {
	const grpcServerPort = Math.floor(Math.random() * 10000 + 10000)
	const serverPort = 8881
	const grpcServerAddr = `localhost:${grpcServerPort}`

	const channel = createChannel(grpcServerAddr)
	const server = makeGrpcServer(grpcServerPort)
	const witnessServer = createMockServer(serverPort)
	const ownerPrivateKey = randomPrivateKey()
	let witnessAddress: string

	beforeAll(async() => {
		await server

		const expectedPubKey = await getVerifierPublicKey()
		witnessAddress = await SelectedServiceSignature.getAddress(
			expectedPubKey
		)
		MOCK_BEACON_STATE_FN.mockImplementation((): BeaconState => {
			return {
				witnesses: [{
					url: grpcServerAddr,
					id: witnessAddress,
				}],
				epoch: 1,
				nextEpochTimestampS: unixTimestampSeconds() + 1000,
				witnessesRequiredForClaim: 1
			}
		})
	})

	afterAll(async() => {
		await channel.close()
		await (await server).close()
		await witnessServer.server.close()
	})

	it('should generate a claim', async() => {
		const beacon = await makeBeacon()
		const state = await beacon.getState()
		const timestampS = unixTimestampSeconds()
		const claimInfo = {
			provider: MOCK_APP_NAME,
			parameters: MOCK_PARAMS,
			context: '',
			sessionId: ''
		}
		const {
			claimData,
			signature,
		} = await generateProviderReceipt({
			name: MOCK_APP_NAME,
			secretParams: { token: 'adhiraj' },
			params: JSON.parse(MOCK_PARAMS),
			requestData: {
				beaconBasedProviderClaimRequest: {
					epoch: state.epoch,
					timestampS,
					info: claimInfo,
					ownerProof: await makeOwnerProof(
						{
							epoch: state.epoch,
							timestampS,
							info: claimInfo,
							ownerProof: undefined
						},
						ownerPrivateKey,
					)
				}
			},
			client: getGrpcClient(),
			additionalConnectOpts: {
				verifyServerCertificate: false
			}
		})

		const dataStr = createSignDataForClaim(claimData!)
		const verified = await SelectedServiceSignature.verify(
			Buffer.from(dataStr),
			signature,
			witnessAddress
		)

		expect(verified).toBeTruthy()
		expect(claimData!.identifier).toBeDefined()
		expect(claimData!.owner).toBeDefined()
		expect(claimData!.timestampS).toEqual(
			timestampS
		)
		expect(claimData!.epoch).toEqual(
			state.epoch
		)
	})

	it('should fail to generate a claim', async() => {
		const beacon = await makeBeacon()
		const state = await beacon.getState()
		const timestampS = unixTimestampSeconds()
		const claimInfo = {
			provider: MOCK_APP_NAME,
			parameters: MOCK_PARAMS,
			context: '',
			sessionId: ''
		}
		await expect(
			generateProviderReceipt({
				name: MOCK_APP_NAME,
				secretParams: { token: 'wrong-token' },
				params: JSON.parse(MOCK_PARAMS),
				requestData: {
					beaconBasedProviderClaimRequest: {
						epoch: state.epoch,
						timestampS,
						info: claimInfo,
						ownerProof: await makeOwnerProof(
							{
								epoch: state.epoch,
								timestampS,
								info: claimInfo,
								ownerProof: undefined
							},
							ownerPrivateKey,
						)
					}
				},
				client: getGrpcClient(),
				additionalConnectOpts: {
					verifyServerCertificate: false
				}
			})
		).rejects.toThrowError(/Invalid email address/)
	})

	it('should create a claim', async() => {
		const { claimData, signatures } = await createClaim({
			name: MOCK_APP_NAME,
			params: JSON.parse(MOCK_PARAMS),
			secretParams: { token: 'adhiraj' },
			ownerPrivateKey,
			makeGrpcClient() {
				return getGrpcClient()
			},
		})

		expect(claimData).toBeDefined()
		expect(signatures).toHaveLength(1)
	})

	async function getVerifierPublicKey() {
		const client = getGrpcClient()
		const res = await client.getVerifierPublicKey({ })

		return res.publicKey
	}

	function getGrpcClient() {
		return createClient(
			ReclaimWitnessDefinition,
			channel,
			{ }
		)
	}
})