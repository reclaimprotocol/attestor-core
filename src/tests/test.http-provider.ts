import { utils, Wallet } from 'ethers'
import P from 'pino'
import { createClaim, generateProviderReceipt } from '../api-client'
import { getContract } from '../beacon/smart-contract/utils'
import { BeaconType } from '../proto/api'
import { providers } from '../providers'
import { HTTPProviderParamsV2 } from '../providers/http-provider'
import { getWitnessClient } from '../scripts/generate-receipt'
import { BeaconState } from '../types'

jest.setTimeout(60_000)

const logger = P()

describe('HTTP Provider tests', () => {

	it('should create receipt', async() => {

		const resp = await createClaim({
			name: 'http',
			beacon: {
				identifier: {
					type: BeaconType.BEACON_TYPE_RECLAIM_TRUSTED,
					id: '0x244897572368eadf65bfbc5aec98d8e5443a9072'
				},
				async getState(epochId?: number): Promise<BeaconState> {
					const chainId = '0x12c'
					const contract = getContract(chainId)
					if(contract) {
						//@ts-ignore
						const epoch = await contract.fetchEpoch(epochId || 0)
						if(!epoch.id) {
							throw new Error(`Invalid epoch ID: ${epochId}`)
						}

						return {
							epoch: epoch.id,
							witnesses: epoch.witnesses.map((w: any) => ({
								id: w.addr.toLowerCase(),
								url: w.host,
							})),
							witnessesRequiredForClaim: epoch.minimumWitnessesForClaimCreation,
							nextEpochTimestampS: epoch.timestampEnd,
						}
					} else {
						throw new Error('contract not found')
					}
				}
			},
			params: {
				url: 'https://example.{{param1}}/',
				method: 'GET',
				responseMatches: [{
					type: 'regex',
					value: '<title.*?(?<domain>{{param2}} Domain)<\\/title>',
				}],
				responseRedactions: [{
					xPath: './html/head/{{param3}}',
				}],
				paramValues: {
					param1: 'com',
					param2: 'Example',
					param3: 'title'
				}
			},
			secretParams: {
				cookieStr: '<cookie-str>'
			},
			ownerPrivateKey: new Wallet(utils.randomBytes(32)).privateKey,
			logger,
		})
		expect(resp.claimData.context).toContain('0x3bfcf3bf17b83b9c37756d9becf87f76cad712304a23d3335f78e1cc96e83d1f')
	})

	it('should generate receipt', async() => {
		const DEFAULT_WITNESS_HOST_PORT = 'https://reclaim-node.questbook.app'
		const client = getWitnessClient(DEFAULT_WITNESS_HOST_PORT)
		const params: HTTPProviderParamsV2 = {
			url: 'https://example.{{param1}}/',
			method: 'GET',
			geoLocation: 'US',
			responseMatches: [{
				type: 'regex',
				value: '<title.*?(?<domain>{{param2}} Domain)<\\/title>',
			},
			{
				type: 'contains',
				value: 'This domain is for use in {{what}} examples in documents',
			}
			],
			responseRedactions: [{
				xPath: './html/head/{{param3}}',
			}, {
				xPath: '/html/body/div/p[1]/text()'
			}],
			paramValues: {
				param1: 'com',
				param2: 'Example',
				param3: 'title',
				what: 'illustrative',
			},
			headers: {
				'user-agent': 'Mozilla/5.0',
			}
		}
		const { receipt } = await generateProviderReceipt({
			name: 'http',
			secretParams: {
				cookieStr: '<cookie-str>',
				authorisationHeader: 'abc'
			},
			params: params,
			client,
			logger,
		})
		expect(receipt?.transcript).not.toBeNull()
		expect(async() => {
			await providers['http'].assertValidProviderReceipt(receipt!, params)
		}).not.toThrow()
	})

	it('should throw on zero body length', async() => {
		const DEFAULT_WITNESS_HOST_PORT = 'https://reclaim-node.questbook.app'
		const client = getWitnessClient(DEFAULT_WITNESS_HOST_PORT)
		const params: HTTPProviderParamsV2 = {
			url: 'https://example.{{param1}}/',
			method: 'GET',
			body: '{{h}}',
			geoLocation: 'US',
			responseMatches: [{
				type: 'regex',
				value: '<title.*?(?<domain>{{param2}} Domain)<\\/title>',
			},
			{
				type: 'contains',
				value: 'This domain is for use in {{what}} examples in documents',
			}
			],
			responseRedactions: [{
				xPath: './html/head/{{param3}}',
			}, {
				xPath: '/html/body/div/p[1]/text()'
			}],
			paramValues: {
				param1: 'com',
				param2: 'Example',
				param3: 'title',
				what: 'illustrative',
			},
			headers: {
				'user-agent': 'Mozilla/5.0',
			}
		}
		const { receipt } = await generateProviderReceipt({
			name: 'http',
			secretParams: {
				cookieStr: '<cookie-str>',
				paramValues: {
					h: '',
				},
				authorisationHeader: 'abc'
			},
			params: params,
			client,
			logger,
		})
		expect(receipt?.transcript).not.toBeNull()
		await expect(async() => {
			await providers['http'].assertValidProviderReceipt(receipt!, params)
		}).rejects.toThrow('request body mismatch')
	})
})