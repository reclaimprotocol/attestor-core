import { strToUint8Array } from '@reclaimprotocol/tls'
import { utils, Wallet } from 'ethers'
import P from 'pino'
import { createClaim, generateProviderReceipt } from '../api-client'
import { getContract } from '../beacon/smart-contract/utils'
import { BeaconType } from '../proto/api'
import { providers } from '../providers'
import { HTTPProviderParamsV2 } from '../providers/http-provider'
import { getWitnessClient } from '../scripts/generate-receipt'
import { BeaconState } from '../types'
import { uint8ArrayToStr } from '../utils'

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

	it('should throw on invalid URL', () => {
		expect(() => {
			const x = typeof providers['http'].hostPort === 'function' ? providers['http'].hostPort({
				url: 'abc',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			}) : ''
			console.log(x)
		}).toThrow('Invalid URL')
	})

	it('should throw on invalid params', () => {
		expect(() => {
			providers['http'].areValidParams({ a: 'b' })
		}).toThrow(/^params validation failed/)
	})

	it('should throw on invalid secret params', () => {
		expect(() => {
			providers['http'].createRequest({
				cookieStr: undefined,
				authorisationHeader: undefined,
				headers: undefined
			}, {
				url: 'abc',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('auth parameters are not set')
	})


	it('should throw on non 200', () => {
		const res =
            `HTTP/1.1 404 NOT FOUND\r
Content-Length: 0\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
`
		expect(() => {
			if(providers['http'].getResponseRedactions) {
				providers['http'].getResponseRedactions(strToUint8Array(res), {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				})
			}
		}).toThrow('Provider returned error \"404 NOT FOUND\"')
	})


	it('should return empty redactions', () => {
		const res =
            `HTTP/1.1 200 OK\r
Content-Length: 0\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
`
		const redactions = (providers['http'].getResponseRedactions) ?
			providers['http'].getResponseRedactions(strToUint8Array(res), {
				url: 'abc',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
			: undefined
		expect(redactions).toHaveLength(0)
	})

	it('should throw on empty body', () => {
		const res =
            `HTTP/1.1 200 OK\r
Content-Length: 0\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
`
		expect(() => {
			if(providers['http'].getResponseRedactions) {
				providers['http'].getResponseRedactions(strToUint8Array(res), {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [{
						regex: 'abc'
					}],
					method: 'GET'
				})
			}
		}).toThrow('Failed to find body')
	})

	it('should throw on bad xpath', () => {
		const res =
            `HTTP/1.1 200 OK\r
Content-Length: 1\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
1`
		expect(() => {
			if(providers['http'].getResponseRedactions) {
				providers['http'].getResponseRedactions(strToUint8Array(res), {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [{
						xPath: 'abc'
					}],
					method: 'GET'
				})
			}
		}).toThrow('Failed to find element: \"abc\"')
	})

	it('should throw on bad jsonPath', () => {
		const res =
            `HTTP/1.1 200 OK\r
Content-Length: 1\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
1`
		expect(() => {
			if(providers['http'].getResponseRedactions) {
				providers['http'].getResponseRedactions(strToUint8Array(res), {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [{
						jsonPath: 'abc'
					}],
					method: 'GET'
				})
			}
		}).toThrow('jsonPath not found')
	})

	it('should throw on bad regex', () => {
		const res =
            `HTTP/1.1 200 OK\r
Content-Length: 1\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
1`
		expect(() => {
			if(providers['http'].getResponseRedactions) {
				providers['http'].getResponseRedactions(strToUint8Array(res), {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [{
						regex: 'abc'
					}],
					method: 'GET'
				})
			}
		}).toThrow('regexp abc does not match found element \'1\'')
	})


	const transcript = JSON.parse('{"hostPort":"xargs.org:443","timestampS":1713948115,"transcript":[{"senderType":1,"redacted":false,"message":{},"packetHeader":[22,3,3,1,139],"plaintextLength":379},{"senderType":2,"redacted":false,"message":{},"packetHeader":[22,3,3,0,155],"plaintextLength":135},{"senderType":2,"redacted":false,"message":{},"packetHeader":[20,3,3,0,1],"plaintextLength":0},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,0,58],"plaintextLength":42},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,11,190],"plaintextLength":2990},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,1,25],"plaintextLength":265},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,0,69],"plaintextLength":53},{"senderType":1,"redacted":false,"message":[20,0,0,48,12,155,252,61,83,49,208,110,6,7,76,55,121,193,216,209,161,65,168,106,27,167,170,85,126,172,17,126,182,6,162,97,188,38,234,38,246,223,216,72,118,225,6,197,129,223,69,210,22],"packetHeader":[23,3,3,0,69],"plaintextLength":53},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,1,42],"plaintextLength":282},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,1,42],"plaintextLength":282},{"senderType":1,"redacted":false,"message":[71,69,84,32,47,32,72,84,84,80,47,49,46,49,13,10,72,111,115,116,58,32,120,97,114,103,115,46,111,114,103,13,10,67,111,110,116,101,110,116,45,76,101,110,103,116,104,58,32,52,13,10,67,111,110,110,101,99,116,105,111,110,58,32,99,108,111,115,101,13,10,65,99,99,101,112,116,45,69,110,99,111,100,105,110,103,58,32,105,100,101,110,116,105,116,121,13,10,117,115,101,114,45,97,103,101,110,116,58,32,77,111,122,105,108,108,97,47,53,46,48,13,10,23],"packetHeader":[23,3,3,0,140],"plaintextLength":124},{"senderType":1,"redacted":true,"message":{},"packetHeader":[23,3,3,0,22],"plaintextLength":6},{"senderType":1,"redacted":true,"message":{},"packetHeader":[23,3,3,0,57],"plaintextLength":41},{"senderType":1,"redacted":true,"message":{},"packetHeader":[23,3,3,0,22],"plaintextLength":6},{"senderType":1,"redacted":false,"message":[13,10,13,10,116,23],"packetHeader":[23,3,3,0,22],"plaintextLength":6},{"senderType":1,"redacted":true,"message":{},"packetHeader":[23,3,3,0,22],"plaintextLength":6},{"senderType":1,"redacted":true,"message":{},"packetHeader":[23,3,3,0,18],"plaintextLength":2},{"senderType":1,"redacted":true,"message":{},"packetHeader":[23,3,3,0,22],"plaintextLength":6},{"senderType":1,"redacted":false,"message":[115,116,23],"packetHeader":[23,3,3,0,19],"plaintextLength":3},{"senderType":2,"redacted":false,"message":[72,84,84,80,47,49,46,49,32,50,48,48,32,79,75,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,23],"packetHeader":[23,3,3,1,110],"plaintextLength":350},{"senderType":2,"redacted":false,"message":[42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,60,116,105,116,108,101,62,65,105,107,101,110,32,38,97,109,112,59,32,68,114,105,115,99,111,108,108,32,38,97,109,112,59,32,87,101,98,98,60,47,116,105,116,108,101,62,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,79,110,101,32,111,102,32,116,104,101,32,102,101,119,32,101,120,99,101,112,116,105,111,110,115,32,105,115,32,97,32,115,101,114,105,101,115,32,111,102,32,100,111,99,117,109,101,110,116,115,32,116,104,97,116,32,73,39,118,101,32,119,114,105,116,116,101,110,10,32,32,32,32,98,114,101,97,107,105,110,103,32,100,111,119,110,32,99,114,121,112,116,111,103,114,97,112,104,105,99,32,97,110,100,32,110,101,116,119,111,114,107,32,112,114,111,116,111,99,111,108,115,32,98,121,116,101,45,98,121,45,98,121,116,101,46,32,73,39,109,10,32,32,32,32,97,108,119,97,121,115,32,104,101,97,114,105,110,103,32,102,114,111,109,32,116,101,97,99,104,101,114,115,44,32,115,116,117,100,101,110,116,115,44,32,97,110,100,32,102,101,108,108,111,119,32,115,111,102,116,119,97,114,101,32,100,101,118,101,108,111,112,101,114,115,10,32,32,32,32,119,104,111,32,117,115,101,32,116,104,101,115,101,32,116,111,32,108,101,97,114,110,44,32,116,111,32,102,105,120,44,32,97,110,100,32,116,111,32,117,110,100,101,114,115,116,97,110,100,46,32,73,39,109,32,118,101,114,121,32,112,114,111,117,100,32,111,102,32,116,104,97,116,46,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,23],"packetHeader":[23,3,3,11,114],"plaintextLength":2914},{"senderType":2,"redacted":true,"message":{},"packetHeader":[23,3,3,0,19],"plaintextLength":3}],"signature":[135,83,140,238,65,100,71,60,12,70,20,132,76,8,86,122,102,120,143,137,245,80,142,21,241,4,54,198,123,33,192,28,37,60,15,39,46,27,168,217,4,50,93,199,13,69,170,239,95,194,35,140,36,114,193,107,150,89,187,102,70,139,163,234,27],"tlsVersion":3,"geoLocation":"US"}')

	it('should throw on bad method', () => {

		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'abc',
				responseMatches: [],
				responseRedactions: [],
				method: 'POST'
			})
		}).toThrow('Invalid method: get')
	})

	it('should throw on bad protocol', () => {

		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'http://xargs.com',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('Expected protocol: https, found: http:')
	})

	it('should throw on duplicate groups', () => {

		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://xargs.{{abc}}',
				responseMatches: [{
					type: 'regex',
					value: '(?<abc>.)'
				}],
				responseRedactions: [],
				method: 'GET',
				paramValues: {
					'abc': 'org'
				}
			})
		}).toThrow('Duplicate parameter abc')
	})

	it('should throw on bad path', () => {

		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://xargs.com/abc',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('Expected path: /abc, found: /')
	})

	it('should throw on bad hostport', () => {

		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://abc.com/',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('Expected hostPort: abc.com:443, found: xargs.org:443')
	})

	it('should throw on bad host', () => {
		const temp = JSON.parse(JSON.stringify(transcript))
		temp.hostPort = 'abc.com:443'
		expect(() => {
			providers['http'].assertValidProviderReceipt(temp, {
				url: 'https://abc.com/',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('Expected host: abc.com, found: xargs.org')
	})

	it('should throw on bad OK string', () => {
		const temp = JSON.parse(JSON.stringify(transcript))
		temp.transcript[19].message[0] = 32
		expect(() => {
			providers['http'].assertValidProviderReceipt(temp, {
				url: 'https://xargs.org/',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('Missing \"HTTP/1.1 200\" header in response')
	})

	it('should throw on bad close header', () => {
		const temp = JSON.parse(JSON.stringify(transcript))
		temp.transcript[10].message[68] = 102
		expect(() => {
			providers['http'].assertValidProviderReceipt(temp, {
				url: 'https://xargs.org/',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('Connection header must be \"close\"')
	})

	it('should throw on bad body', () => {
		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://xargs.org/',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET',
				body: 'abc'
			})
		}).toThrow('request body mismatch')
	})

	it('should throw on bad regex match', () => {
		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://xargs.org/',
				responseMatches: [{
					type: 'regex',
					value: 'abc'
				}],
				responseRedactions: [],
				method: 'GET',
			})
		}).toThrow('Invalid receipt. Regex \"abc\" didn\'t match')
	})

	it('should throw on bad contains match', () => {
		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://xargs.org/',
				responseMatches: [{
					type: 'contains',
					value: 'abc'
				}],
				responseRedactions: [],
				method: 'GET',
			})
		}).toThrow('Invalid receipt. Response does not contain \"abc\"')
	})

	it('should get geo', () => {
		// @ts-ignore
		expect(providers['http'].geoLocation({
			geoLocation: '{{geo}}',
			paramValues: {
				'geo': 'US'
			}
		})).toEqual('US')
	})

	it('should throw on bad geo param', () => {

		expect(() => {
			// @ts-ignore
			providers['http'].geoLocation({
				geoLocation: '{{geo}}',
				paramValues: {
					'geo1': 'US'
				}
			})
		}).toThrow('parameter "geo" value not found in templateParams')
	})

	it('should return empty geo', () => {

		expect(// @ts-ignore
			providers['http'].geoLocation({
				geoLocation: '',
			})).toEqual(undefined)
	})

	it('should throw on bad param in url', () => {

		expect(() => {
			// @ts-ignore
			return providers['http'].hostPort(
				{
					url: 'https://xargs.{{param1}}'
				})
		})
			.toThrow('parameter "param1" value not found in templateParams')
	})

	it('should throw on bad url', () => {

		expect(() => {
			// @ts-ignore
			providers['http'].hostPort(
				{
					url: 'file:///C:/path'
				})
		})
			.toThrow('url is incorrect')
	})

	it('should throw on bad match type', () => {
		expect(() => {
			const params = {
				url: 'https://xargs.org/',
				responseMatches: [{
					type: 'abc',
					value: 'abc'
				}],
				responseRedactions: [],
				method: 'GET',
			}
			// @ts-ignore
			providers['http'].assertValidProviderReceipt(transcript, params)
		}).toThrow('Invalid response match type abc')
	})

	it('should throw on no non present params', () => {
		expect(() => {
			providers['http'].assertValidProviderReceipt(transcript, {
				url: 'https://xargs.{{org}}/',
				responseMatches: [{
					type: 'contains',
					value: 'abc'
				}],
				responseRedactions: [],
				method: 'GET',
			})
		}).toThrow('parameter\'s \"org\" value not found in paramValues')
	})

	it('should throw on non present secret params', () => {
		expect(() => {
			providers['http'].createRequest({
				cookieStr: 'abc',

			}, {
				url: 'https://xargs.{{com}}',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			})
		}).toThrow('parameter\'s \"com\" value not found in paramValues and secret parameter\'s paramValues')
	})

	it('should replace params in body correctly', () => {
		const params: HTTPProviderParamsV2 = {
			url: 'https://example.{{param1}}/',
			method: 'GET',
			body: 'hello {{h}} {{b}} {{h1h1h1h1h1h1h1}} {{h2}} {{a}} {{h1h1h1h1h1h1h1}} {{h}} {{a}} {{h2}} {{a}} {{b}} world',
			geoLocation: 'US',
			responseMatches: [{
				type: 'regex',
				value: '<title.*?(?<domain>{{param2}} Domain)<\\/title>',
			}],
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
				a:'{{b}}',
				b:'aaaaa'
			},
			headers: {
				'user-agent': 'Mozilla/5.0',
			}
		}
		const secretParams = {
			cookieStr: '<cookie-str>',
			paramValues: {
				h: 'crazy',
				h1h1h1h1h1h1h1: 'crazy1',
				h2: 'crazy2',
			},
			authorisationHeader: 'abc'
		}
		const req = providers['http'].createRequest(secretParams, params)

		const reqText = uint8ArrayToStr(req.data as Uint8Array)
		expect(reqText).toContain('hello crazy aaaaa crazy1 crazy2 {{b}} crazy1 crazy {{b}} crazy2 {{b}} aaaaa world')
		expect(req.redactions.length).toEqual(7)
		expect(getRedaction(0)).toEqual('Cookie: <cookie-str>\r\nAuthorization: abc')
		expect(getRedaction(1)).toEqual('crazy')
		expect(getRedaction(2)).toEqual('crazy1')
		expect(getRedaction(3)).toEqual('crazy2')
		expect(getRedaction(4)).toEqual('crazy1')
		expect(getRedaction(5)).toEqual('crazy')
		expect(getRedaction(6)).toEqual('crazy2')

		function getRedaction(index: number) {
			return uint8ArrayToStr((req.data as Uint8Array).slice(req.redactions[index].fromIndex, req.redactions[index].toIndex))
		}
	})
})