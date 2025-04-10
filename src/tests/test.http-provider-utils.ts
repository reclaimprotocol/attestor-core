import { strToUint8Array } from '@reclaimprotocol/tls'
import assert from 'assert'
import { PROVIDER_CTX } from 'src/config'
import { providers } from 'src/providers'
import httpProvider from 'src/providers/http'
import {
	extractHTMLElement, extractHTMLElements,
	extractJSONValueIndex, extractJSONValueIndexes,
	makeRegex,
	matchRedactedStrings,
} from 'src/providers/http/utils'
import { RES_CHUNKED_PARTIAL_BODY } from 'src/tests/test.http-parser'
import { ProviderParams, Transcript } from 'src/types'
import { assertValidateProviderParams, getBlocksToReveal, getProviderValue, hashProviderParams, logger, uint8ArrayToStr } from 'src/utils'
import { deserialize, serialize } from 'v8'

jest.setTimeout(60_000)

const ctx = PROVIDER_CTX

describe('HTTP Provider Utils tests', () => {

	const {
		hostPort,
		geoLocation,
		getResponseRedactions,
		createRequest,
		assertValidProviderReceipt
	} = providers['http']

	const transcript: Transcript<Uint8Array> = JSON.parse('[' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=","sender":"server"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKg==","sender":"server"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioq","sender":"server"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKg==","sender":"server"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=","sender":"server"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=","sender":"server"},' +
		'{"message":"R0VUIC8gSFRUUC8xLjENCkhvc3Q6IHhhcmdzLm9yZw0KQ29udGVudC1MZW5ndGg6IDQNCkNvbm5lY3Rpb246IGNsb3NlDQpBY2NlcHQtRW5jb2Rpbmc6IGlkZW50aXR5DQp1c2VyLWFnZW50OiBNb3ppbGxhLzUuMA0K","sender":"client"},' +
		'{"message":"KioqKio=","sender":"client"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKg==","sender":"client"},' +
		'{"message":"KioqKio=","sender":"client"},' +
		'{"message":"DQoNCnQ=","sender":"client"},' +
		'{"message":"KioqKio=","sender":"client"},' +
		'{"message":"Kg==","sender":"client"},' +
		'{"message":"KioqKio=","sender":"client"},' +
		'{"message":"c3Q=","sender":"client"},' +
		'{"message":"SFRUUC8xLjEgMjAwIE9LKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKg0KDQo=","sender":"server"},' +
		'{"message":"KioqKioqKioqKioqKioqKioqKioqKioqKioqKjx0aXRsZT5BaWtlbiAmYW1wOyBEcmlzY29sbCAmYW1wOyBXZWJiPC90aXRsZT4qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqT25lIG9mIHRoZSBmZXcgZXhjZXB0aW9ucyBpcyBhIHNlcmllcyBvZiBkb2N1bWVudHMgdGhhdCBJJ3ZlIHdyaXR0ZW4KICAgIGJyZWFraW5nIGRvd24gY3J5cHRvZ3JhcGhpYyBhbmQgbmV0d29yayBwcm90b2NvbHMgYnl0ZS1ieS1ieXRlLiBJJ20KICAgIGFsd2F5cyBoZWFyaW5nIGZyb20gdGVhY2hlcnMsIHN0dWRlbnRzLCBhbmQgZmVsbG93IHNvZnR3YXJlIGRldmVsb3BlcnMKICAgIHdobyB1c2UgdGhlc2UgdG8gbGVhcm4sIHRvIGZpeCwgYW5kIHRvIHVuZGVyc3RhbmQuIEknbSB2ZXJ5IHByb3VkIG9mIHRoYXQuKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioq","sender":"server"},{"message":"Kio=","sender":"server"}]')
		.map((x) => ({
			...x,
			message: Buffer.from(x.message, 'base64'),
		}))

	it('should parse xpath & JSON path', () => {
		const json = extractHTMLElement(html, "//script[@data-component-name='Navbar']", true)
		const val = extractJSONValueIndex(json, '$.hasBookface')
		const rm = '"hasBookface":true'
		const regexp = new RegExp(rm, 'gim')

		expect(regexp.test(json.slice(val.start, val.end))).toBe(true)
	})


	it('should extract complex JSON path', () => {
		const json = `{
    "items":[
        {
            "name": "John Doe",
            "country": "USA"
        },
        {
          "country": "USA",
          "age":25
        }
    ]
}`
		const val = extractJSONValueIndex(json, '$.items[?(@.name.match(/.*oe/))].name')
		const rm = '"name": "John Doe"'
		const regexp = new RegExp(rm, 'gim')

		expect(regexp.test(json.slice(val.start, val.end))).toBe(true)
	})


	it('should get inner & outer tag contents', () => {
		const html = `<body>
			  <div id="content123">This is <span>some</span> text!</div>
			  <div id="content456">This is <span>some</span> other text!</div>
			  <div id="content789">This is <span>some</span> irrelevant text!</div>
			</body>`

		let content = extractHTMLElement(html, "//div[contains(@id, 'content123')]", true)
		expect(content).toEqual('This is <span>some</span> text!')
		content = extractHTMLElement(html, "//div[contains(@id, 'content456')]", false)
		expect(content).toEqual('<div id="content456">This is <span>some</span> other text!</div>')
	})


	it('should get multiple elements', () => {
		const html = `<body>
			  <div id="content123">This is <span>some</span> text!</div>
			  <div id="content456">This is <span>some</span> other text!</div>
			  <div id="content789">This is <span>some</span> irrelevant text!</div>
			</body>`

		const contents = extractHTMLElements(html, '//body/div', true)
		expect(contents).toEqual(['This is <span>some</span> text!', 'This is <span>some</span> other text!', 'This is <span>some</span> irrelevant text!'])
	})


	it('should get multiple JSONPaths', () => {
		const jsonData = `{
    "firstName": "John",
    "lastName": "doe",
    "age": 26,
    "address": {
        "streetAddress": "naist street",
        "city": "Nara",
        "postalCode": "630-0192"
    },
    "phoneNumbers": [
        {
            "type": "iPhone",
            "number": "0123-4567-8888"
        },
        {
            "type": "home",
            "number": "0123-4567-8910"
        }
    ]
}`

		const contents = extractJSONValueIndexes(jsonData, '$.phoneNumbers[*].number')

		const res: string[] = []
		for(const { start, end } of contents) {
			res.push(jsonData.slice(start, end))
		}

		expect(res).toEqual(['"number": "0123-4567-8888"', '"number": "0123-4567-8910"'])
	})

	it('should error on incorrect jsonPath', () => {
		expect(() => {
			extractJSONValueIndex(('{"asdf": 1}'), '(alert(origin))')
		}).toThrow('loc.indexOf is not a function')
	})

	it('should not error on incorrect regex', () => {
		expect(() => {
			const regexp = makeRegex('([a-z]+)+$')
			regexp.test('a'.repeat(31) + '\x00')
		}).not.toThrow()
	})

	it('should hide chunked parts from response', () => {
		const provider = httpProvider
		const simpleChunk = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n9\r\nchunk 1, \r\n7\r\nchunk 2\r\n0\r\n')

		if(provider.getResponseRedactions) {
			const redactions = provider.getResponseRedactions({
				response: simpleChunk,
				params: {
					method: 'GET',
					url: 'https://test.com',
					'responseMatches': [

					],
					'responseRedactions': [
						{
							'regex': 'chunk 1, chunk 2'
						}
					],
				},
				logger,
				ctx
			})
			expect(redactions).toEqual([
				{
					'fromIndex': 15,
					'toIndex': 88,
				},
				{
					'fromIndex': 92,
					'toIndex': 95
				},
				{
					'fromIndex': 104,
					'toIndex': 109
				},
				{
					'fromIndex': 116,
					'toIndex': 121
				}
			])

			let start = 0
			let str = ''
			for(const red of redactions) {
				str += simpleChunk.subarray(start, red.fromIndex)
				start = red.toIndex
			}

			expect(str).toEqual('HTTP/1.1 200 OK\r\n\r\nchunk 1, chunk 2')
		}

	})

	it('should perform complex redactions', () => {
		const provider = httpProvider
		const response = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\ncontent-length: 222\r\nConnection: close\r\n\r\n<body> <div id="c1">{"ages":[{"age":"26"},{"age":"27"},{"age":"28"}]}</div> <div id="c2">{"ages":[{"age":"27"},{"age":"28"},{"age":"29"}]}</div> <div id="c3">{"ages":[{"age":"29"},{"age":"30"},{"age":"31"}]}</div></body>\r\n')

		if(provider.getResponseRedactions) {
			const redactions = provider.getResponseRedactions({
				response,
				params: {
					method: 'GET',
					url: 'https://test.com',
					'responseMatches': [],
					'responseRedactions': [
						{
							'xPath': '//body/div',
							'jsonPath':'$.ages[*].age',
							'regex':'(2|3)\\d'
						}
					],
				},
				logger,
				ctx,
			})
			expect(redactions).toEqual([
				{
					'fromIndex': 15,
					'toIndex': 81,
				},
				{
					'fromIndex': 85,
					'toIndex': 122
				},
				{
					'fromIndex': 124,
					'toIndex': 135
				},
				{
					'fromIndex': 137,
					'toIndex': 148
				},
				{
					'fromIndex': 150,
					'toIndex': 191
				},
				{
					'fromIndex': 193,
					'toIndex': 204
				},
				{
					'fromIndex': 206,
					'toIndex': 217
				},
				{
					'fromIndex': 219,
					'toIndex': 260
				},
				{
					'fromIndex': 262,
					'toIndex': 273
				},
				{
					'fromIndex': 275,
					'toIndex': 286
				},
				{
					'fromIndex': 288,
					'toIndex': 307
				}
			])

			let start = 0
			let str = ''
			for(const red of redactions) {
				str += response.subarray(start, red.fromIndex)
				start = red.toIndex
			}

			expect(str).toEqual('HTTP/1.1 200 OK\r\n\r\n262728272829293031')
		}

	})

	it('should perform complex redactions 2', () => {
		const provider = httpProvider
		const response = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\ncontent-length: 51\r\nConnection: close\r\n\r\n{"ages":[{"age":"26"},{"age":"27"},{"age":"28"}]}\r\n')

		if(provider.getResponseRedactions) {
			const redactions = provider.getResponseRedactions({
				response,
				params: {
					method: 'GET',
					url: 'https://test.com',
					'responseMatches': [

					],
					'responseRedactions': [
						{
							'jsonPath':'$.ages[*].age',
							'regex':'(2|3)\\d'
						}
					],
				},
				logger,
				ctx,
			})
			expect(redactions).toEqual([
				{
					'fromIndex': 15,
					'toIndex': 80,
				},
				{
					'fromIndex': 84,
					'toIndex': 101
				},
				{
					'fromIndex': 103,
					'toIndex': 114
				},
				{
					'fromIndex': 116,
					'toIndex': 127
				},
				{
					'fromIndex': 129,
					'toIndex': 135
				}
			])

			let start = 0
			let str = ''
			for(const red of redactions) {
				str += response.subarray(start, red.fromIndex)
				start = red.toIndex
			}

			expect(str).toEqual('HTTP/1.1 200 OK\r\n\r\n262728')
		}

	})

	it('should perform complex redactions 3', () => {
		const provider = httpProvider
		const response = Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\ncontent-length: 222\r\nConnection: close\r\n\r\n<body> <div id="c1">{"ages":[{"age":"26"},{"age":"27"},{"age":"28"}]}</div> <div id="c2">{"ages":[{"age":"27"},{"age":"28"},{"age":"29"}]}</div> <div id="c3">{"ages":[{"age":"29"},{"age":"30"},{"age":"31"}]}</div></body>\r\n')

		if(provider.getResponseRedactions) {
			const redactions = provider.getResponseRedactions({
				response,
				params: {
					method: 'GET',
					url: 'https://test.com',
					'responseMatches': [],
					'responseRedactions': [
						{
							'xPath': '//body/div',
							'regex': '"age":"\\d{2}"'
						}
					],
				},
				logger,
				ctx,
			})
			expect(redactions).toEqual([
				{
					'fromIndex': 15,
					'toIndex': 81,
				},
				{
					'fromIndex': 85,
					'toIndex': 115
				},
				{
					'fromIndex': 125,
					'toIndex': 184
				},
				{
					'fromIndex': 194,
					'toIndex': 253
				},
				{
					'fromIndex': 263,
					'toIndex': 307
				}
			])

			let start = 0
			let str = ''
			for(const red of redactions) {
				str += response.subarray(start, red.fromIndex)
				start = red.toIndex
			}

			expect(str).toEqual('HTTP/1.1 200 OK\r\n\r\n"age":"26""age":"27""age":"29"')
		}
	})

	it('should get redactions from chunked response', () => {
		const provider = httpProvider
		if(provider.getResponseRedactions) {
			const redactions = provider.getResponseRedactions({
				response: chunkedResp,
				params: {
					method: 'GET',
					url: 'https://bookface.ycombinator.com/home',
					'responseMatches': [

					],
					'responseRedactions': [
						{
							'xPath': "//script[@id='js-react-on-rails-context']",
							'jsonPath': '$.currentUser',
						},
						{
							'xPath': "//script[@data-component-name='BookfaceCsrApp']",
							'jsonPath': '$.hasBookface',
						},
						{
							'regex': 'code_version:\\s"[0-9a-f]{40}\\sruby'
						}
					],
				},
				logger,
				ctx,
			})
			expect(redactions).toEqual([
				{
					'fromIndex': 15,
					'toIndex': 17
				},
				{
					'fromIndex': 52,
					'toIndex': 4290,
				},
				{
					'fromIndex': 4294,
					'toIndex': 4760
				},
				{
					'fromIndex': 4820,
					'toIndex': 53268
				},
				{
					'fromIndex': 53507,
					'toIndex': 58705
				},
				{
					'fromIndex': 58723,
					'toIndex': 64093
				}
			])
		}

	})
	it('should hash provider params consistently', () => {
		const params: ProviderParams<'http'> = {
			url: 'https://xargs.org/',
			responseMatches: [
				{
					type: 'regex',
					value: '<title.*?(?<name>Aiken &amp; Driscoll &amp; Webb)<\\/title>'
				}
			],
			method: 'GET',
			responseRedactions: [{ xPath: './html/head/title' }],
			geoLocation: 'US',
		}
		const hash = hashProviderParams(params)
		expect(hash).toEqual('0xe9624d26421a4d898d401e98821ccd645c25b06de97746a6c24a8b12d9aec143')


		const paramsEx: ProviderParams<'http'> = {
			'geoLocation': '',
			'url': 'https://www.linkedin.com/dashboard/',
			'method': 'GET',
			'body': '',
			'responseMatches': [
				{
					'value': 'TOTAL_FOLLOWERS&quot;,&quot;$recipeTypes&quot;:[&quot;com.linkedin.c123aee2ba3dfeb6a4580e7effdf5d3f&quot;],&quot;analyticsTitle&quot;:{&quot;textDirection&quot;:&quot;USER_LOCALE&quot;,&quot;text&quot;:&quot;581&quot;',
					'type': 'contains'
				}],
			'responseRedactions': [{
				'xPath': '{{xpath}}',
				'jsonPath': '',
				'regex': 'TOTAL_FOLLOWERS&quot;,&quot;\\$recipeTypes&quot;:(.*?),&quot;analyticsTitle&quot;:{&quot;textDirection&quot;:&quot;USER_LOCALE&quot;,&quot;text&quot;:&quot;(.*?)&quot;'
			}]
		}
		expect(hashProviderParams(paramsEx)).toEqual('0x6fb81ebab0fb5dca0356abfd8726af97675e4a426712377bfc6ad9a0271c913b')
	})

	it('should match redacted strings', () => {
		const testCases: { a: string, b: string }[] = [
			{
				a: 'aaa',
				b: 'aaa'
			},
			{
				a: '{{abc}}',
				b: '************'
			},
			{
				a: '{{abc}}d',
				b: '*d'
			},
			{
				a: 'd{{abc}}',
				b: 'd*******************************************'
			},
			{
				a: 'd{{abc}}d{{abwewewewec}}',
				b: 'd*d*'
			},
			{
				a: '{{abc}}x{{abwewewewec}}',
				b: '*x*'
			}
		]

		for(const { a, b } of testCases) {
			expect(matchRedactedStrings(strToUint8Array(a), strToUint8Array(b))).toBeTruthy()
		}
	})

	it('should not match bad redacted strings', () => {
		const testCases: { a: string, b: string }[] = [
			{
				a: 'aaa',
				b: 'aab'
			},
			{
				a: '{{abc}}',
				b: ''
			},
			{
				a: '',
				b: '*****'
			},
			{
				a: '{{abc}}{{abc}}d',
				b: '*d'
			},
			{
				a: '{{yy',
				b: '*'
			},
			{
				a: '{{abc}}d{{abwewewewec}}',
				b: 'a*d*'
			},
			{
				a: '{abc}}',
				b: '************'
			}
		]

		for(const { a, b } of testCases) {
			expect(matchRedactedStrings(strToUint8Array(a), strToUint8Array(b))).toBeFalsy()
		}
	})


	it('should throw on invalid URL', () => {
		expect(
			() => (
				getProviderValue(
					{
						url: 'abc',
						responseMatches: [],
						responseRedactions: [],
						method: 'GET'
					},
					hostPort
				)
			)
		).toThrow('Invalid URL')
	})

	it('should throw on invalid params', () => {
		expect(() => {
			assertValidateProviderParams('http', { a: 'b', body: 2 })
		}).toThrow(/^Params validation failed/)
	})

	it('should throw on invalid secret params', () => {
		expect(() => {
			createRequest({
				cookieStr: undefined,
				authorisationHeader: undefined,
				headers: undefined
			}, {
				url: 'abc',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			}, logger)
		}).toThrow('auth parameters are not set')
	})

	it('should return empty redactions', () => {
		const res =
            `HTTP/1.1 200 OK\r
Content-Length: 0\r
Connection: close\r
Content-Type: text/html; charset=utf-8\r
\r
`
		const redactions = (getResponseRedactions) ?
			getResponseRedactions({
				response: strToUint8Array(res),
				params: {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				},
				logger,
				ctx
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
			if(getResponseRedactions) {
				getResponseRedactions({
					response: strToUint8Array(res),
					params: {
						url: 'abc',
						responseMatches: [],
						responseRedactions: [{
							regex: 'abc'
						}],
						method: 'GET'
					},
					logger,
					ctx,
				})
			}
		}).toThrow('Failed to find response body')
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
			if(getResponseRedactions) {
				getResponseRedactions({
					response: strToUint8Array(res),
					params: {
						url: 'abc',
						responseMatches: [],
						responseRedactions: [{
							xPath: 'abc'
						}],
						method: 'GET'
					},
					logger,
					ctx
				})
			}
		}).toThrow('Failed to find XPath: \"abc\"')
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
			if(getResponseRedactions) {
				getResponseRedactions({
					response: strToUint8Array(res),
					params: {
						url: 'abc',
						responseMatches: [],
						responseRedactions: [{
							jsonPath: 'abc'
						}],
						method: 'GET'
					},
					logger,
					ctx,
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
			if(getResponseRedactions) {
				getResponseRedactions({
					response: strToUint8Array(res),
					params: {
						url: 'abc',
						responseMatches: [],
						responseRedactions: [{
							regex: 'abc'
						}],
						method: 'GET'
					},
					logger,
					ctx,
				})
			}
		}).toThrow('regexp abc does not match found element \'MQ==\'')
	})

	it('should throw on bad method', async() => {
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'abc',
					responseMatches: [],
					responseRedactions: [],
					method: 'POST'
				},
				logger,
				ctx
			})
		}).rejects.toThrow('Invalid method: get')
	})

	it('should throw on bad protocol', async() => {

		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'http://xargs.com',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				},
				logger,
				ctx,
			})
		}).rejects.toThrow('Expected protocol: https, found: http:')
	})

	it('should throw on duplicate groups', async() => {

		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
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
				},
				logger,
				ctx
			})
		}).rejects.toThrow('Duplicate parameter abc')
	})

	it('should throw on bad path', async() => {

		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'https://xargs.com/abc',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				},
				logger,
				ctx
			})
		}).rejects.toThrow('Expected path: /abc, found: /')
	})

	it('should throw on bad host', async() => {
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'https://abc.com/',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				},
				logger,
				ctx,
			})
		}).rejects.toThrow('Expected host: abc.com, found: xargs.org')
	})

	it('should throw on bad OK string', async() => {
		const temp = cloneObject(transcript)
		// changes the status ("OK") text to something else
		// it'll be in the first server response packet
		const firstServerMsg = temp.find((x, index) => x.sender === 'server' && index !== 0)!
		firstServerMsg.message[0] = 32
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: temp,
				params: {
					url: 'https://xargs.org/',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				},
				logger,
				ctx,
			})
		}).rejects.toThrow('Response did not start with \"HTTP/1.1 2XX\"')
	})

	it('should throw on bad close header', async() => {
		const temp = cloneObject(transcript)
		const clientMsgWithClose = temp.find((x) => {
			if(x.sender !== 'client') {
				return false
			}

			return uint8ArrayToStr(x.message)
				.includes('Connection: close')
		})!
		clientMsgWithClose.message[68] = 102
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: temp,
				params: {
					url: 'https://xargs.org/',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET'
				},
				logger,
				ctx
			})
		}).rejects.toThrow('Connection header must be \"close\"')
	})

	it('should throw on bad body', async() => {
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'https://xargs.org/',
					responseMatches: [],
					responseRedactions: [],
					method: 'GET',
					body: 'abc'
				},
				logger,
				ctx
			})
		}).rejects.toThrow('request body mismatch')
	})

	it('should throw on bad regex match', async() => {
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'https://xargs.org/',
					responseMatches: [{
						type: 'regex',
						value: 'abc'
					}],
					responseRedactions: [],
					method: 'GET',
				},
				logger,
				ctx
			})
		}).rejects.toThrow('Invalid receipt. Regex \"abc\" didn\'t match')
	})

	it('should throw on bad contains match', async() => {
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'https://xargs.org/',
					responseMatches: [{
						type: 'contains',
						value: 'abc'
					}],
					responseRedactions: [],
					method: 'GET',
				},
				logger,
				ctx,
			})
		}).rejects.toThrow('Invalid receipt. Response does not contain \"abc\"')
	})

	it('should get geo', () => {
		const geo = getProviderValue(
			{
				geoLocation: '{{geo}}',
				paramValues: {
					'geo': 'US'
				}
			} as unknown as ProviderParams<'http'>,
			geoLocation
		)
		expect(geo).toEqual('US')
	})

	it('should throw on bad geo param', () => {

		expect(() => {
			// @ts-ignore
			geoLocation({
				geoLocation: '{{geo}}',
				paramValues: {
					'geo1': 'US'
				}
			})
		}).toThrow('parameter "geo" value not found in templateParams')
	})

	it('should return empty geo', () => {

		expect(// @ts-ignore
			geoLocation({
				geoLocation: '',
			})).toEqual(undefined)
	})

	it('should throw on bad param in url', () => {

		expect(() => {
			// @ts-ignore
			return hostPort(
				{
					url: 'https://xargs.{{param1}}'
				})
		})
			.toThrow('parameter "param1" value not found in templateParams')
	})

	it('should throw on bad url', () => {

		expect(() => {
			// @ts-ignore
			hostPort(
				{
					url: 'file:///C:/path'
				})
		})
			.toThrow('url is incorrect')
	})

	it('should throw on bad match type', async() => {
		await expect(async() => {
			const params = {
				url: 'https://xargs.org/',
				responseMatches: [{
					type: 'abc',
					value: 'abc'
				}],
				responseRedactions: [],
				method: 'GET',
			}
			await assertValidProviderReceipt({
				receipt: transcript,
				// @ts-ignore
				params,
				logger,
				ctx,
			})
		}).rejects.toThrow('Invalid response match type abc')
	})

	it('should throw on no non present params', async() => {
		await expect(async() => {
			await assertValidProviderReceipt({
				receipt: transcript,
				params: {
					url: 'https://xargs.{{org}}/',
					responseMatches: [{
						type: 'contains',
						value: 'abc'
					}],
					responseRedactions: [],
					method: 'GET',
				},
				logger,
				ctx
			})
		}).rejects.toThrow('Expected host: xargs.{{org}}, found: xargs.org')
	})

	it('should throw on non present secret params', () => {
		expect(() => {
			createRequest({
				cookieStr: 'abc',

			}, {
				url: 'https://xargs.{{com}}',
				responseMatches: [],
				responseRedactions: [],
				method: 'GET'
			}, logger)
		}).toThrow('parameter\'s \"com\" value not found in paramValues and secret parameter\'s paramValues')
	})

	it('should replace params in body correctly', () => {
		const params: ProviderParams<'http'> = {
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
		const req = createRequest(secretParams, params, logger)

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

	it('should replace params in body correctly case 2', () => {
		const params: ProviderParams<'http'> = {
			'body': '{"includeGroups":{{REQ_DAT}},"includeLogins":{{REQ_SECRET}},"includeVerificationStatus":false}',
			'geoLocation': '',
			'method': 'POST',
			'paramValues': {
				'REQ_DAT': 'false',
				'username': 'testyreclaim'
			},
			'responseMatches': [
				{
					'type': 'contains',
					'value': '"userName":"{{username}}"'
				}
			],
			'responseRedactions': [
				{
					'jsonPath': '$.userName',
					'regex': '"userName":"(.*)"',
					'xPath': ''
				}
			],
			'url': 'https://www.kaggle.com'
		}
		const secretParams = {
			'paramValues': {
				'REQ_SECRET': 'false'
			},
			authorisationHeader: 'abc'
		}

		const req = createRequest(secretParams, params, logger)

		const reqText = uint8ArrayToStr(req.data as Uint8Array)
		expect(reqText).toContain('{\"includeGroups\":false,\"includeLogins\":false,\"includeVerificationStatus\":false}')
		expect(req.redactions.length).toEqual(2)
		expect(getRedaction(0)).toEqual('Authorization: abc')
		expect(getRedaction(1)).toEqual('false')

		function getRedaction(index: number) {
			return uint8ArrayToStr((req.data as Uint8Array).slice(req.redactions[index].fromIndex, req.redactions[index].toIndex))
		}
	})

	describe('OPRF', () => {
		it('should handle OPRF replacements', async() => {
			const params: ProviderParams<'http'> = {
				url: 'https://example.com/',
				method: 'GET',
				responseMatches: [
					{
						type: 'regex',
						value: '<title>(?<domain>.+)<\\/title>',
					}
				],
				responseRedactions: [
					{
						regex: '<title>(?<domain>.+)<\\/title>',
						hash: 'oprf'
					}
				],
			}
			const res = Buffer.from(
				'SFRUUC8xLjEgMjAwIE9LDQpBY2NlcHQtUmFuZ2VzOiBieXRlcw0KQWdlOiAzNzIxNDcNCkNhY2hlLUNvbnRyb2w6IG1heC1hZ2U9NjA0ODAwDQpDb250ZW50LVR5cGU6IHRleHQvaHRtbDsgY2hhcnNldD1VVEYtOA0KRGF0ZTogVGh1LCAyMSBOb3YgMjAyNCAwNTozOTo0NiBHTVQNCkV0YWc6ICIzMTQ3NTI2OTQ3Ig0KRXhwaXJlczogVGh1LCAyOCBOb3YgMjAyNCAwNTozOTo0NiBHTVQNCkxhc3QtTW9kaWZpZWQ6IFRodSwgMTcgT2N0IDIwMTkgMDc6MTg6MjYgR01UDQpTZXJ2ZXI6IEVDQWNjIChsYWMvNTVCNSkNClZhcnk6IEFjY2VwdC1FbmNvZGluZw0KWC1DYWNoZTogSElUDQpDb250ZW50LUxlbmd0aDogMTI1Ng0KQ29ubmVjdGlvbjogY2xvc2UNCg0KPCFkb2N0eXBlIGh0bWw+CjxodG1sPgo8aGVhZD4KICAgIDx0aXRsZT5FeGFtcGxlIERvbWFpbjwvdGl0bGU+CgogICAgPG1ldGEgY2hhcnNldD0idXRmLTgiIC8+CiAgICA8bWV0YSBodHRwLWVxdWl2PSJDb250ZW50LXR5cGUiIGNvbnRlbnQ9InRleHQvaHRtbDsgY2hhcnNldD11dGYtOCIgLz4KICAgIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MSIgLz4KICAgIDxzdHlsZSB0eXBlPSJ0ZXh0L2NzcyI+CiAgICBib2R5IHsKICAgICAgICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjBmMGYyOwogICAgICAgIG1hcmdpbjogMDsKICAgICAgICBwYWRkaW5nOiAwOwogICAgICAgIGZvbnQtZmFtaWx5OiAtYXBwbGUtc3lzdGVtLCBzeXN0ZW0tdWksIEJsaW5rTWFjU3lzdGVtRm9udCwgIlNlZ29lIFVJIiwgIk9wZW4gU2FucyIsICJIZWx2ZXRpY2EgTmV1ZSIsIEhlbHZldGljYSwgQXJpYWwsIHNhbnMtc2VyaWY7CiAgICAgICAgCiAgICB9CiAgICBkaXYgewogICAgICAgIHdpZHRoOiA2MDBweDsKICAgICAgICBtYXJnaW46IDVlbSBhdXRvOwogICAgICAgIHBhZGRpbmc6IDJlbTsKICAgICAgICBiYWNrZ3JvdW5kLWNvbG9yOiAjZmRmZGZmOwogICAgICAgIGJvcmRlci1yYWRpdXM6IDAuNWVtOwogICAgICAgIGJveC1zaGFkb3c6IDJweCAzcHggN3B4IDJweCByZ2JhKDAsMCwwLDAuMDIpOwogICAgfQogICAgYTpsaW5rLCBhOnZpc2l0ZWQgewogICAgICAgIGNvbG9yOiAjMzg0ODhmOwogICAgICAgIHRleHQtZGVjb3JhdGlvbjogbm9uZTsKICAgIH0KICAgIEBtZWRpYSAobWF4LXdpZHRoOiA3MDBweCkgewogICAgICAgIGRpdiB7CiAgICAgICAgICAgIG1hcmdpbjogMCBhdXRvOwogICAgICAgICAgICB3aWR0aDogYXV0bzsKICAgICAgICB9CiAgICB9CiAgICA8L3N0eWxlPiAgICAKPC9oZWFkPgoKPGJvZHk+CjxkaXY+CiAgICA8aDE+RXhhbXBsZSBEb21haW48L2gxPgogICAgPHA+VGhpcyBkb21haW4gaXMgZm9yIHVzZSBpbiBpbGx1c3RyYXRpdmUgZXhhbXBsZXMgaW4gZG9jdW1lbnRzLiBZb3UgbWF5IHVzZSB0aGlzCiAgICBkb21haW4gaW4gbGl0ZXJhdHVyZSB3aXRob3V0IHByaW9yIGNvb3JkaW5hdGlvbiBvciBhc2tpbmcgZm9yIHBlcm1pc3Npb24uPC9wPgogICAgPHA+PGEgaHJlZj0iaHR0cHM6Ly93d3cuaWFuYS5vcmcvZG9tYWlucy9leGFtcGxlIj5Nb3JlIGluZm9ybWF0aW9uLi4uPC9hPjwvcD4KPC9kaXY+CjwvYm9keT4KPC9odG1sPgo=',
				'base64'
			)
			const redactedStr = await getRedactedStr(res, params)
			// the transcript contained "Example Domain" in the title
			// which should be replaced with the hash
			expect(redactedStr).toContain('<title>AAAAAAAAAAAAAA</title>')
		})

		it('should handle OPRF replacements in a chunked res', async() => {
			const params: ProviderParams<'http'> = {
				url: 'https://example.com/',
				method: 'GET',
				responseMatches: [
					{
						type: 'regex',
						value: '\"name\":\"(?<name>.+?)\"',
					}
				],
				responseRedactions: [
					{
						regex: '\"name\":\"(?<name>.+?)\"',
						hash: 'oprf'
					}
				],
			}
			const arr = strToUint8Array(RES_CHUNKED_PARTIAL_BODY)
			const redactedStr = await getRedactedStr(arr, params)
			// "name":"John" should be replaced with the hash
			expect(redactedStr).toContain('"name":"AAAA"')
		})

		it('should gracefully error when OPRF spans multiple chunks', () => {
			const params: ProviderParams<'http'> = {
				url: 'https://example.com/',
				method: 'GET',
				responseMatches: [
					{
						type: 'regex',
						value: '\"house\":\"(?<house>.+?)\"',
					}
				],
				responseRedactions: [
					{
						regex: '\"house\":\"(?<house>.+?)\"',
						hash: 'oprf'
					}
				],
			}

			const response = strToUint8Array(RES_CHUNKED_PARTIAL_BODY)
			expect(
				() => getResponseRedactions!({
					response, params, logger, ctx
				})
			).toThrow(/cannot be performed/)
		})
	})

	it('should replace secret params in URL correctly', () => {
		const params: ProviderParams<'http'> = {
			'body': '',
			'geoLocation': '',
			'method': 'POST',
			'paramValues': {
				'username': 'testyreclaim'
			},
			'responseMatches': [
				{
					'type': 'contains',
					'value': '"userName":"{{username}}"'
				}
			],
			'responseRedactions': [
				{
					'jsonPath': '$.userName',
					'regex': '"userName":"(.*)"',
					'xPath': ''
				}
			],
			'url': 'https://www.kaggle.com/{{auth_token}}?request={{param_request}}'
		}
		const secretParams = {
			'paramValues': {
				'auth_token': '1234567890',
				'param_request':'select * from users'
			},
			authorisationHeader: 'abc'
		}

		const req = createRequest(secretParams, params, logger)

		const reqText = uint8ArrayToStr(req.data as Uint8Array)
		expect(reqText).toContain('POST /1234567890?request=select * from users HTTP/1.1')
		expect(req.redactions.length).toEqual(3)
		expect(getRedaction(2)).toEqual('Authorization: abc')
		expect(getRedaction(0)).toEqual('1234567890')
		expect(getRedaction(1)).toEqual('select * from users')

		function getRedaction(index: number) {
			return uint8ArrayToStr((req.data as Uint8Array).slice(req.redactions[index].fromIndex, req.redactions[index].toIndex))
		}
	})

	async function getRedactedStr(
		plaintext: Uint8Array,
		params: ProviderParams<'http'>,
	) {
		const hash = new Uint8Array(32)
		const trans = await getBlocksToReveal(
			[{ plaintext }],
			response => getResponseRedactions!({
				response, params, logger, ctx
			}),
			async txt => ({
				nullifier: hash,
				dataLocation: { fromIndex: 0, length: txt.length },
				responses: [],
				mask: new Uint8Array(0),
				plaintext: plaintext
			})
		)
		assert(trans !== 'all', 'Expected not all blocks to be revealed')
		const redactedStr = uint8ArrayToStr(trans[0].redactedPlaintext)
		// the transcript contained "Example Domain" in the title
		// which should be replaced with the hash
		return redactedStr
	}
})

function cloneObject<T>(obj: T): T {
	// use node serialization to clone object
	// to allow binary data to be cloned
	return deserialize(serialize(obj))
}

const html = `
<!DOCTYPE html><html class="home index"><head><title>Home | Bookface</title><script>window.RAILS_ENV = 'production';</script><script>var _rollbarConfig = {
	accessToken: "1aa22a01bffe4c07b70adcedb63ed76d",
	captureUncaught: true,
	captureUnhandledRejections: true,
	payload: {
		client: {
			javascript: {
				source_map_enabled: true,
				code_version: "9af724bccab729487057681b5e91f7a7c45cabf4",
				guess_uncaught_frames: true
			}
		},
		environment: 'browser-production',
		person: {
		  id: "123",
		  username: "qweqwe"
		}
	},
	transform: function(payload) {
	  var trace = payload.body.trace;
	  var locRegex = /^(https?):\/\/[^\/]+\/(.*)/
	  if (trace && trace.frames) {
		for (var i = 0; i < trace.frames.length; i++) {
		  var filename = trace.frames[i].filename;
		  if (filename) {
			var m = filename.match(locRegex);
			if (m) {
			  trace.frames[i].filename = m[1] + '://dynamichost/' + m[2];
			}
		  }
		}
	  }
	}
  };
  
  // Rollbar Snippet
  !function(r){var e={};function o(n){if(e[n])return e[n].exports;var t=e[n]={i:n,l:!1,exports:{}};return r[n].call(t.exports,t,t.exports,o),t.l=!0,t.exports}o.m=r,o.c=e,o.d=function(r,e,n){o.o(r,e)||Object.defineProperty(r,e,{enumerable:!0,get:n})},o.r=function(r){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(r,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(r,"__esModule",{value:!0})},o.t=function(r,e){if(1&e&&(r=o(r)),8&e)return r;if(4&e&&"object"==typeof r&&r&&r.__esModule)return r;var n=Object.create(null);if(o.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:r}),2&e&&"string"!=typeof r)for(var t in r)o.d(n,t,function(e){return r[e]}.bind(null,t));return n},o.n=function(r){var e=r&&r.__esModule?function(){return r.default}:function(){return r};return o.d(e,"a",e),e},o.o=function(r,e){return Object.prototype.hasOwnProperty.call(r,e)},o.p="",o(o.s=0)}([function(r,e,o){"use strict";var n=o(1),t=o(5);_rollbarConfig=_rollbarConfig||{},_rollbarConfig.rollbarJsUrl=_rollbarConfig.rollbarJsUrl||"https://cdn.rollbar.com/rollbarjs/refs/tags/v2.19.0/rollbar.min.js",_rollbarConfig.async=void 0===_rollbarConfig.async||_rollbarConfig.async;var a=n.setupShim(window,_rollbarConfig),l=t(_rollbarConfig);window.rollbar=n.Rollbar,a.loadFull(window,document,!_rollbarConfig.async,_rollbarConfig,l)},function(r,e,o){"use strict";var n=o(2),t=o(3);function a(r){return function(){try{return r.apply(this,arguments)}catch(r){try{console.error("[Rollbar]: Internal error",r)}catch(r){}}}}var l=0;function i(r,e){this.options=r,this._rollbarOldOnError=null;var o=l++;this.shimId=function(){return o},"undefined"!=typeof window&&window._rollbarShims&&(window._rollbarShims[o]={handler:e,messages:[]})}var s=o(4),d=function(r,e){return new i(r,e)},c=function(r){return new s(d,r)};function u(r){return a((function(){var e=this,o=Array.prototype.slice.call(arguments,0),n={shim:e,method:r,args:o,ts:new Date};window._rollbarShims[this.shimId()].messages.push(n)}))}i.prototype.loadFull=function(r,e,o,n,t){var l=!1,i=e.createElement("script"),s=e.getElementsByTagName("script")[0],d=s.parentNode;i.crossOrigin="",i.src=n.rollbarJsUrl,o||(i.async=!0),i.onload=i.onreadystatechange=a((function(){if(!(l||this.readyState&&"loaded"!==this.readyState&&"complete"!==this.readyState)){i.onload=i.onreadystatechange=null;try{d.removeChild(i)}catch(r){}l=!0,function(){var e;if(void 0===r._rollbarDidLoad){e=new Error("rollbar.js did not load");for(var o,n,a,l,i=0;o=r._rollbarShims[i++];)for(o=o.messages||[];n=o.shift();)for(a=n.args||[],i=0;i<a.length;++i)if("function"==typeof(l=a[i])){l(e);break}}"function"==typeof t&&t(e)}()}})),d.insertBefore(i,s)},i.prototype.wrap=function(r,e,o){try{var n;if(n="function"==typeof e?e:function(){return e||{}},"function"!=typeof r)return r;if(r._isWrap)return r;if(!r._rollbar_wrapped&&(r._rollbar_wrapped=function(){o&&"function"==typeof o&&o.apply(this,arguments);try{return r.apply(this,arguments)}catch(o){var e=o;throw e&&("string"==typeof e&&(e=String(e)),e._rollbarContext=n()||{},e._rollbarContext._wrappedSource=r.toString(),window._rollbarWrappedError=e),e}},r._rollbar_wrapped._isWrap=!0,r.hasOwnProperty))for(var t in r)r.hasOwnProperty(t)&&(r._rollbar_wrapped[t]=r[t]);return r._rollbar_wrapped}catch(e){return r}};for(var p="log,debug,info,warn,warning,error,critical,global,configure,handleUncaughtException,handleAnonymousErrors,handleUnhandledRejection,captureEvent,captureDomContentLoaded,captureLoad".split(","),f=0;f<p.length;++f)i.prototype[p[f]]=u(p[f]);r.exports={setupShim:function(r,e){if(r){var o=e.globalAlias||"Rollbar";if("object"==typeof r[o])return r[o];r._rollbarShims={},r._rollbarWrappedError=null;var l=new c(e);return a((function(){e.captureUncaught&&(l._rollbarOldOnError=r.onerror,n.captureUncaughtExceptions(r,l,!0),e.wrapGlobalEventHandlers&&t(r,l,!0)),e.captureUnhandledRejections&&n.captureUnhandledRejections(r,l,!0);var a=e.autoInstrument;return!1!==e.enabled&&(void 0===a||!0===a||"object"==typeof a&&a.network)&&r.addEventListener&&(r.addEventListener("load",l.captureLoad.bind(l)),r.addEventListener("DOMContentLoaded",l.captureDomContentLoaded.bind(l))),r[o]=l,l}))()}},Rollbar:c}},function(r,e,o){"use strict";function n(r,e,o,n){r._rollbarWrappedError&&(n[4]||(n[4]=r._rollbarWrappedError),n[5]||(n[5]=r._rollbarWrappedError._rollbarContext),r._rollbarWrappedError=null);var t=e.handleUncaughtException.apply(e,n);o&&o.apply(r,n),"anonymous"===t&&(e.anonymousErrorsPending+=1)}r.exports={captureUncaughtExceptions:function(r,e,o){if(r){var t;if("function"==typeof e._rollbarOldOnError)t=e._rollbarOldOnError;else if(r.onerror){for(t=r.onerror;t._rollbarOldOnError;)t=t._rollbarOldOnError;e._rollbarOldOnError=t}e.handleAnonymousErrors();var a=function(){var o=Array.prototype.slice.call(arguments,0);n(r,e,t,o)};o&&(a._rollbarOldOnError=t),r.onerror=a}},captureUnhandledRejections:function(r,e,o){if(r){"function"==typeof r._rollbarURH&&r._rollbarURH.belongsToShim&&r.removeEventListener("unhandledrejection",r._rollbarURH);var n=function(r){var o,n,t;try{o=r.reason}catch(r){o=void 0}try{n=r.promise}catch(r){n="[unhandledrejection] error getting promise from event"}try{t=r.detail,!o&&t&&(o=t.reason,n=t.promise)}catch(r){}o||(o="[unhandledrejection] error getting reason from event"),e&&e.handleUnhandledRejection&&e.handleUnhandledRejection(o,n)};n.belongsToShim=o,r._rollbarURH=n,r.addEventListener("unhandledrejection",n)}}}},function(r,e,o){"use strict";function n(r,e,o){if(e.hasOwnProperty&&e.hasOwnProperty("addEventListener")){for(var n=e.addEventListener;n._rollbarOldAdd&&n.belongsToShim;)n=n._rollbarOldAdd;var t=function(e,o,t){n.call(this,e,r.wrap(o),t)};t._rollbarOldAdd=n,t.belongsToShim=o,e.addEventListener=t;for(var a=e.removeEventListener;a._rollbarOldRemove&&a.belongsToShim;)a=a._rollbarOldRemove;var l=function(r,e,o){a.call(this,r,e&&e._rollbar_wrapped||e,o)};l._rollbarOldRemove=a,l.belongsToShim=o,e.removeEventListener=l}}r.exports=function(r,e,o){if(r){var t,a,l="EventTarget,Window,Node,ApplicationCache,AudioTrackList,ChannelMergerNode,CryptoOperation,EventSource,FileReader,HTMLUnknownElement,IDBDatabase,IDBRequest,IDBTransaction,KeyOperation,MediaController,MessagePort,ModalWindow,Notification,SVGElementInstance,Screen,TextTrack,TextTrackCue,TextTrackList,WebSocket,WebSocketWorker,Worker,XMLHttpRequest,XMLHttpRequestEventTarget,XMLHttpRequestUpload".split(",");for(t=0;t<l.length;++t)r[a=l[t]]&&r[a].prototype&&n(e,r[a].prototype,o)}}},function(r,e,o){"use strict";function n(r,e){this.impl=r(e,this),this.options=e,function(r){for(var e=function(r){return function(){var e=Array.prototype.slice.call(arguments,0);if(this.impl[r])return this.impl[r].apply(this.impl,e)}},o="log,debug,info,warn,warning,error,critical,global,configure,handleUncaughtException,handleAnonymousErrors,handleUnhandledRejection,_createItem,wrap,loadFull,shimId,captureEvent,captureDomContentLoaded,captureLoad".split(","),n=0;n<o.length;n++)r[o[n]]=e(o[n])}(n.prototype)}n.prototype._swapAndProcessMessages=function(r,e){var o,n,t;for(this.impl=r(this.options);o=e.shift();)n=o.method,t=o.args,this[n]&&"function"==typeof this[n]&&("captureDomContentLoaded"===n||"captureLoad"===n?this[n].apply(this,[t[0],o.ts]):this[n].apply(this,t));return this},r.exports=n},function(r,e,o){"use strict";r.exports=function(r){return function(e){if(!e&&!window._rollbarInitialized){for(var o,n,t=(r=r||{}).globalAlias||"Rollbar",a=window.rollbar,l=function(r){return new a(r)},i=0;o=window._rollbarShims[i++];)n||(n=o.handler),o.handler._swapAndProcessMessages(l,o.messages);window[t]=n,window._rollbarInitialized=!0}}}}]);
  // End Rollbar Snippet</script><script>window.AlgoliaOpts = {"key":"OWE1NzQ0MzgzYjY0NGI0OGEyMzljZDZlY2VjODUzZDcwOWZjNzljYTUxY2JiMzVjNjFlZGYxYzIxZWY0NDc1ZHRhZ0ZpbHRlcnM9JTVCJTVCJTIycHVibGljJTIyJTJDJTIyYmF0Y2hfdzIwMjElMjIlMkMlMjJib29rZmFjZV9jaGFubmVsX2NsYXNzaWZpZWRzJTIyJTJDJTIyYm9va2ZhY2VfY2hhbm5lbF9sYXVuY2hfYm9va2ZhY2UlMjIlMkMlMjJib29rZmFjZV9jaGFubmVsX3JlY3J1aXRpbmclMjIlMkMlMjJib29rZmFjZV9jaGFubmVsX2dlbmVyYWwlMjIlMkMlMjJib29rZmFjZV9jaGFubmVsX3cyMDIxXzMlMjIlMkMlMjJib29rZmFjZV9jaGFubmVsX3cyMDIxJTIyJTJDJTIyYm9va2ZhY2VfY2hhbm5lbF9hbm5vdW5jZW1lbnRzJTIyJTJDJTIyYm9va2ZhY2VfY2hhbm5lbF9mZWF0dXJlZCUyMiUyQyUyMmJvb2tmYWNlX2NoYW5uZWxfYWxsJTIyJTJDJTIyYWN0aXZlX2ZvdW5kZXJzJTIyJTJDJTIyZGRheV9iYXRjaF93MjAyMyUyMiUyQyUyMmFsbF9mb3VuZGVycyUyMiUyQyUyMndhYXNfYWNjZXNzJTIyJTJDJTIyZnVuZHJhaXNpbmclMjIlMkMlMjJkZWFscyUzQWF1ZGllbmNlJTNBYWxsX2ZvdW5kZXJzJTIyJTJDJTIyZGVhbHMlM0FhdWRpZW5jZSUzQWFjdGl2ZV9mb3VuZGVycyUyMiUyQyUyMmRlYWxzJTNBb3duZWRfYnlfdXNlciUzQTE4Mjg1MyUyMiUyQyUyMmRlYWxzJTNBb3duZWRfYnlfY29tcGFueSUzQTIzMTA1JTIyJTVEJTVEJnVzZXJUb2tlbj0xSjBVbnA3cWZuZWN5NVR6Y2w1YVpycXB4VDljVUZxM2JiVU0yeUlDJTJCTjAlM0QmYW5hbHl0aWNzVGFncz0lNUIlNUIlMjJib29rZmFjZSUyMiUyQyUyMmFsdW1uaSUyMiUyQyUyMmFjdGl2ZSUyMiU1RCU1RA==","app":"45BWZJ1SGC","tag_filters":"(public,batch_w2021,bookface_channel_classifieds,bookface_channel_launch_bookface,bookface_channel_recruiting,bookface_channel_general,bookface_channel_w2021_3,bookface_channel_w2021,bookface_channel_announcements,bookface_channel_featured,bookface_channel_all,active_founders,dday_batch_w2023,all_founders,waas_access,fundraising,deals:audience:all_founders,deals:audience:active_founders,deals:owned_by_user:182853,deals:owned_by_company:23105)"};</script><meta name="csrf-param" content="authenticity_token" />
  <meta name="csrf-token" content="V4opQ8owGbameRXSOV-tI7DNGnvOjer5dD4dMPzKJXyNHX2QiZyt9C7pmHCk2RQVi_lF8t8oTyOuxOVSwXV5Iw" /><link href="/assets/favicon-402519a37fed7880aea64ce37c210cd32c33be9b468fb2668ffcd6faec51260d.ico" rel="icon" type="image/x-icon" /><link href="/assets/favicon-402519a37fed7880aea64ce37c210cd32c33be9b468fb2668ffcd6faec51260d.ico" rel="shortcut icon" type="image/x-icon" /><link href="/manifest.json" rel="manifest" /><link href="//cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.3/css/font-awesome.min.css" rel="stylesheet" /><link href="//cdnjs.cloudflare.com/ajax/libs/ionicons/3.0.0/css/ionicons.min.css" rel="stylesheet" /><link href="https://bookface.ycombinator.com/search/opensearch?token=ea742fc7-3bc3-4c59-8e71-80983227a57f" rel="search" title="Bookface" type="application/opensearchdescription+xml" /><meta content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" name="viewport" /><meta charset="utf-8" />
  <script type="text/javascript">window.NREUM||(NREUM={});NREUM.info={"beacon":"bam.nr-data.net","errorBeacon":"bam.nr-data.net","licenseKey":"f604a527b0","applicationID":"97963418","transactionName":"cg0NQhFeVVgAExdeV1wHTF8NVVxM","queueTime":0,"applicationTime":262,"agent":""}</script>
  <script type="text/javascript">(window.NREUM||(NREUM={})).init={ajax:{deny_list:["bam.nr-data.net"]}};(window.NREUM||(NREUM={})).loader_config={licenseKey:"f604a527b0",applicationID:"97963418"};;(()=>{var e,t,r={8768:(e,t,r)=>{"use strict";r.d(t,{T:()=>n,p:()=>i});const n=/(iPad|iPhone|iPod)/g.test(navigator.userAgent),i=n&&Boolean("undefined"==typeof SharedWorker)},27:(e,t,r)=>{"use strict";r.d(t,{P_:()=>h,Mt:()=>v,C5:()=>d,DL:()=>y,OP:()=>O,lF:()=>R,Yu:()=>A,Dg:()=>p,CX:()=>f,GE:()=>w,sU:()=>C});var n={};r.r(n),r.d(n,{agent:()=>x,match:()=>k,version:()=>j});var i=r(6797),o=r(909),a=r(8610);class s{constructor(e,t){try{if(!e||"object"!=typeof e)return(0,a.Z)("New setting a Configurable requires an object as input");if(!t||"object"!=typeof t)return(0,a.Z)("Setting a Configurable requires a model to set its initial properties");Object.assign(this,t),Object.entries(e).forEach((e=>{let[t,r]=e;const n=(0,o.q)(t);n.length&&r&&"object"==typeof r&&n.forEach((e=>{e in r&&((0,a.Z)('"'.concat(e,'" is a protected attribute and can not be changed in feature ').concat(t,".  It will have no effect.")),delete r[e])})),this[t]=r}))}catch(e){(0,a.Z)("An error occured while setting a Configurable",e)}}}const c={beacon:i.ce.beacon,errorBeacon:i.ce.errorBeacon,licenseKey:void 0,applicationID:void 0,sa:void 0,queueTime:void 0,applicationTime:void 0,ttGuid:void 0,user:void 0,account:void 0,product:void 0,extra:void 0,jsAttributes:{},userAttributes:void 0,atts:void 0,transactionName:void 0,tNamePlain:void 0},u={};function d(e){if(!e)throw new Error("All info objects require an agent identifier!");if(!u[e])throw new Error("Info for ".concat(e," was never set"));return u[e]}function f(e,t){if(!e)throw new Error("All info objects require an agent identifier!");u[e]=new s(t,c),(0,i.Qy)(e,u[e],"info")}const l={allow_bfcache:!0,privacy:{cookies_enabled:!0},ajax:{deny_list:void 0,enabled:!0,harvestTimeSeconds:10},distributed_tracing:{enabled:void 0,exclude_newrelic_header:void 0,cors_use_newrelic_header:void 0,cors_use_tracecontext_headers:void 0,allowed_origins:void 0},ssl:void 0,obfuscate:void 0,jserrors:{enabled:!0,harvestTimeSeconds:10},metrics:{enabled:!0},page_action:{enabled:!0,harvestTimeSeconds:30},page_view_event:{enabled:!0},page_view_timing:{enabled:!0,harvestTimeSeconds:30,long_task:!1},session_trace:{enabled:!0,harvestTimeSeconds:10},spa:{enabled:!0,harvestTimeSeconds:10}},g={};function h(e){if(!e)throw new Error("All configuration objects require an agent identifier!");if(!g[e])throw new Error("Configuration for ".concat(e," was never set"));return g[e]}function p(e,t){if(!e)throw new Error("All configuration objects require an agent identifier!");g[e]=new s(t,l),(0,i.Qy)(e,g[e],"config")}function v(e,t){if(!e)throw new Error("All configuration objects require an agent identifier!");var r=h(e);if(r){for(var n=t.split("."),i=0;i<n.length-1;i++)if("object"!=typeof(r=r[n[i]]))return;r=r[n[n.length-1]]}return r}const m={accountID:void 0,trustKey:void 0,agentID:void 0,licenseKey:void 0,applicationID:void 0,xpid:void 0},b={};function y(e){if(!e)throw new Error("All loader-config objects require an agent identifier!");if(!b[e])throw new Error("LoaderConfig for ".concat(e," was never set"));return b[e]}function w(e,t){if(!e)throw new Error("All loader-config objects require an agent identifier!");b[e]=new s(t,m),(0,i.Qy)(e,b[e],"loader_config")}const A=(0,i.mF)().o;var x=null,j=null;const _=/Version\/(\S+)\s+Safari/;if(navigator.userAgent){var D=navigator.userAgent,E=D.match(_);E&&-1===D.indexOf("Chrome")&&-1===D.indexOf("Chromium")&&(x="Safari",j=E[1])}function k(e,t){if(!x)return!1;if(e!==x)return!1;if(!t)return!0;if(!j)return!1;for(var r=j.split("."),n=t.split("."),i=0;i<n.length;i++)if(n[i]!==r[i])return!1;return!0}var S=r(2400),P=r(2374),I=r(8226);const T=e=>({buildEnv:I.Re,bytesSent:{},customTransaction:void 0,disabled:!1,distMethod:I.gF,isolatedBacklog:!1,loaderType:void 0,maxBytes:3e4,offset:Math.floor(P._A?.performance?.timeOrigin||P._A?.performance?.timing?.navigationStart||Date.now()),onerror:void 0,origin:""+P._A.location,ptid:void 0,releaseIds:{},sessionId:1==v(e,"privacy.cookies_enabled")?(0,S.Bj)():null,xhrWrappable:"function"==typeof P._A.XMLHttpRequest?.prototype?.addEventListener,userAgent:n,version:I.q4}),N={};function O(e){if(!e)throw new Error("All runtime objects require an agent identifier!");if(!N[e])throw new Error("Runtime for ".concat(e," was never set"));return N[e]}function C(e,t){if(!e)throw new Error("All runtime objects require an agent identifier!");N[e]=new s(t,T(e)),(0,i.Qy)(e,N[e],"runtime")}function R(e){return function(e){try{const t=d(e);return!!t.licenseKey&&!!t.errorBeacon&&!!t.applicationID}catch(e){return!1}}(e)}},8226:(e,t,r)=>{"use strict";r.d(t,{Re:()=>i,gF:()=>o,q4:()=>n});const n="1.230.0",i="PROD",o="CDN"},9557:(e,t,r)=>{"use strict";r.d(t,{w:()=>o});var n=r(8610);const i={agentIdentifier:""};class o{constructor(e){try{if("object"!=typeof e)return(0,n.Z)("shared context requires an object as input");this.sharedContext={},Object.assign(this.sharedContext,i),Object.entries(e).forEach((e=>{let[t,r]=e;Object.keys(i).includes(t)&&(this.sharedContext[t]=r)}))}catch(e){(0,n.Z)("An error occured while setting SharedContext",e)}}}},4329:(e,t,r)=>{"use strict";r.d(t,{L:()=>d,R:()=>c});var n=r(3752),i=r(7022),o=r(4045),a=r(2325);const s={};function c(e,t){const r={staged:!1,priority:a.p[t]||0};u(e),s[e].get(t)||s[e].set(t,r)}function u(e){e&&(s[e]||(s[e]=new Map))}function d(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:"",t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"feature";if(u(e),!e||!s[e].get(t))return a(t);s[e].get(t).staged=!0;const r=Array.from(s[e]);function a(t){const r=e?n.ee.get(e):n.ee,a=o.X.handlers;if(r.backlog&&a){var s=r.backlog[t],c=a[t];if(c){for(var u=0;s&&u<s.length;++u)f(s[u],c);(0,i.D)(c,(function(e,t){(0,i.D)(t,(function(t,r){r[0].on(e,r[1])}))}))}delete a[t],r.backlog[t]=null,r.emit("drain-"+t,[])}}r.every((e=>{let[t,r]=e;return r.staged}))&&(r.sort(((e,t)=>e[1].priority-t[1].priority)),r.forEach((e=>{let[t]=e;a(t)})))}function f(e,t){var r=e[1];(0,i.D)(t[r],(function(t,r){var n=e[0];if(r[0]===n){var i=r[1],o=e[3],a=e[2];i.apply(o,a)}}))}},3752:(e,t,r)=>{"use strict";r.d(t,{ee:()=>u});var n=r(6797),i=r(3916),o=r(7022),a=r(27),s="nr@context";let c=(0,n.fP)();var u;function d(){}function f(){return new d}function l(){u.aborted=!0,u.backlog={}}c.ee?u=c.ee:(u=function e(t,r){var n={},c={},g={},h=!1;try{h=16===r.length&&(0,a.OP)(r).isolatedBacklog}catch(e){}var p={on:b,addEventListener:b,removeEventListener:y,emit:m,get:A,listeners:w,context:v,buffer:x,abort:l,aborted:!1,isBuffering:j,debugId:r,backlog:h?{}:t&&"object"==typeof t.backlog?t.backlog:{}};return p;function v(e){return e&&e instanceof d?e:e?(0,i.X)(e,s,f):f()}function m(e,r,n,i,o){if(!1!==o&&(o=!0),!u.aborted||i){t&&o&&t.emit(e,r,n);for(var a=v(n),s=w(e),d=s.length,f=0;f<d;f++)s[f].apply(a,r);var l=_()[c[e]];return l&&l.push([p,e,r,a]),a}}function b(e,t){n[e]=w(e).concat(t)}function y(e,t){var r=n[e];if(r)for(var i=0;i<r.length;i++)r[i]===t&&r.splice(i,1)}function w(e){return n[e]||[]}function A(t){return g[t]=g[t]||e(p,t)}function x(e,t){var r=_();p.aborted||(0,o.D)(e,(function(e,n){t=t||"feature",c[n]=t,t in r||(r[t]=[])}))}function j(e){return!!_()[c[e]]}function _(){return p.backlog}}(void 0,"globalEE"),c.ee=u)},9252:(e,t,r)=>{"use strict";r.d(t,{E:()=>n,p:()=>i});var n=r(3752).ee.get("handle");function i(e,t,r,i,o){o?(o.buffer([e],i),o.emit(e,t,r)):(n.buffer([e],i),n.emit(e,t,r))}},4045:(e,t,r)=>{"use strict";r.d(t,{X:()=>o});var n=r(9252);o.on=a;var i=o.handlers={};function o(e,t,r,o){a(o||n.E,i,e,t,r)}function a(e,t,r,i,o){o||(o="feature"),e||(e=n.E);var a=t[o]=t[o]||{};(a[r]=a[r]||[]).push([e,i])}},8544:(e,t,r)=>{"use strict";r.d(t,{bP:()=>s,iz:()=>c,m$:()=>a});var n=r(2374);let i=!1,o=!1;try{const e={get passive(){return i=!0,!1},get signal(){return o=!0,!1}};n._A.addEventListener("test",null,e),n._A.removeEventListener("test",null,e)}catch(e){}function a(e,t){return i||o?{capture:!!e,passive:i,signal:t}:!!e}function s(e,t){let r=arguments.length>2&&void 0!==arguments[2]&&arguments[2];window.addEventListener(e,t,a(r))}function c(e,t){let r=arguments.length>2&&void 0!==arguments[2]&&arguments[2];document.addEventListener(e,t,a(r))}},5526:(e,t,r)=>{"use strict";r.d(t,{Rl:()=>i,ky:()=>o});var n=r(2374);function i(){var e=null,t=0,r=n._A?.crypto||n._A?.msCrypto;function i(){return e?15&e[t++]:16*Math.random()|0}r&&r.getRandomValues&&(e=r.getRandomValues(new Uint8Array(31)));for(var o,a="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",s="",c=0;c<a.length;c++)s+="x"===(o=a[c])?i().toString(16):"y"===o?(o=3&i()|8).toString(16):o;return s}function o(e){var t=null,r=0,n=self.crypto||self.msCrypto;n&&n.getRandomValues&&Uint8Array&&(t=n.getRandomValues(new Uint8Array(31)));for(var i=[],o=0;o<e;o++)i.push(a().toString(16));return i.join("");function a(){return t?15&t[r++]:16*Math.random()|0}}},2053:(e,t,r)=>{"use strict";function n(){return Math.round(performance.now())}r.d(t,{z:()=>n})},8610:(e,t,r)=>{"use strict";function n(e,t){"function"==typeof console.warn&&(console.warn("New Relic: ".concat(e)),t&&console.warn(t))}r.d(t,{Z:()=>n})},3916:(e,t,r)=>{"use strict";r.d(t,{X:()=>i});var n=Object.prototype.hasOwnProperty;function i(e,t,r){if(n.call(e,t))return e[t];var i=r();if(Object.defineProperty&&Object.keys)try{return Object.defineProperty(e,t,{value:i,writable:!0,enumerable:!1}),i}catch(e){}return e[t]=i,i}},2374:(e,t,r)=>{"use strict";r.d(t,{_A:()=>o,il:()=>n,lW:()=>a,v6:()=>i});const n=Boolean("undefined"!=typeof window&&window.document),i=Boolean("undefined"!=typeof WorkerGlobalScope&&self.navigator instanceof WorkerNavigator);let o=(()=>{if(n)return window;if(i){if("undefined"!=typeof globalThis&&globalThis instanceof WorkerGlobalScope)return globalThis;if(self instanceof WorkerGlobalScope)return self}throw new Error('New Relic browser agent shutting down due to error: Unable to locate global scope. This is possibly due to code redefining browser global variables like "self" and "window".')})();function a(){return o}},7022:(e,t,r)=>{"use strict";r.d(t,{D:()=>n});const n=(e,t)=>Object.entries(e||{}).map((e=>{let[r,n]=e;return t(r,n)}))},2438:(e,t,r)=>{"use strict";r.d(t,{P:()=>o});var n=r(3752);const i=()=>{const e=new WeakSet;return(t,r)=>{if("object"==typeof r&&null!==r){if(e.has(r))return;e.add(r)}return r}};function o(e){try{return JSON.stringify(e,i())}catch(e){try{n.ee.emit("internal-error",[e])}catch(e){}}}},2650:(e,t,r)=>{"use strict";r.d(t,{K:()=>a,b:()=>o});var n=r(8544);function i(){return"undefined"==typeof document||"complete"===document.readyState}function o(e,t){if(i())return e();(0,n.bP)("load",e,t)}function a(e){if(i())return e();(0,n.iz)("DOMContentLoaded",e)}},6797:(e,t,r)=>{"use strict";r.d(t,{EZ:()=>u,Qy:()=>c,ce:()=>o,fP:()=>a,gG:()=>d,mF:()=>s});var n=r(2053),i=r(2374);const o={beacon:"bam.nr-data.net",errorBeacon:"bam.nr-data.net"};function a(){return i._A.NREUM||(i._A.NREUM={}),void 0===i._A.newrelic&&(i._A.newrelic=i._A.NREUM),i._A.NREUM}function s(){let e=a();return e.o||(e.o={ST:i._A.setTimeout,SI:i._A.setImmediate,CT:i._A.clearTimeout,XHR:i._A.XMLHttpRequest,REQ:i._A.Request,EV:i._A.Event,PR:i._A.Promise,MO:i._A.MutationObserver,FETCH:i._A.fetch}),e}function c(e,t,r){let i=a();const o=i.initializedAgents||{},s=o[e]||{};return Object.keys(s).length||(s.initializedAt={ms:(0,n.z)(),date:new Date}),i.initializedAgents={...o,[e]:{...s,[r]:t}},i}function u(e,t){a()[e]=t}function d(){return function(){let e=a();const t=e.info||{};e.info={beacon:o.beacon,errorBeacon:o.errorBeacon,...t}}(),function(){let e=a();const t=e.init||{};e.init={...t}}(),s(),function(){let e=a();const t=e.loader_config||{};e.loader_config={...t}}(),a()}},6998:(e,t,r)=>{"use strict";r.d(t,{N:()=>i});var n=r(8544);function i(e){let t=arguments.length>1&&void 0!==arguments[1]&&arguments[1];return void(0,n.iz)("visibilitychange",(function(){if(t){if("hidden"!=document.visibilityState)return;e()}e(document.visibilityState)}))}},2400:(e,t,r)=>{"use strict";r.d(t,{Bj:()=>c,GD:()=>s,J8:()=>u,ju:()=>o});var n=r(5526);const i="NRBA/";function o(e,t){let r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:"";try{return window.sessionStorage.setItem(i+r+e,t),!0}catch(e){return!1}}function a(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"";return window.sessionStorage.getItem(i+t+e)}function s(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"";try{window.sessionStorage.removeItem(i+t+e)}catch(e){}}function c(){try{let e;return null===(e=a("SESSION_ID"))&&(e=(0,n.ky)(16),o("SESSION_ID",e)),e}catch(e){return null}}function u(){let e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:"";const t=i+e,r={};try{for(let n=0;n<window.sessionStorage.length;n++){let i=window.sessionStorage.key(n);i.startsWith(t)&&(i=i.slice(t.length),r[i]=a(i,e))}}catch(e){}return r}},6034:(e,t,r)=>{"use strict";r.d(t,{gF:()=>o,mY:()=>i,t9:()=>n,vz:()=>s,xS:()=>a});const n=r(2325).D.metrics,i="sm",o="cm",a="storeSupportabilityMetrics",s="storeEventMetrics"},2484:(e,t,r)=>{"use strict";r.d(t,{Dz:()=>i,OJ:()=>a,qw:()=>o,t9:()=>n});const n=r(2325).D.pageViewEvent,i="firstbyte",o="domcontent",a="windowload"},6382:(e,t,r)=>{"use strict";r.d(t,{t:()=>n});const n=r(2325).D.pageViewTiming},1509:(e,t,r)=>{"use strict";r.d(t,{W:()=>s});var n=r(27),i=r(3752),o=r(2384),a=r(6797);class s{constructor(e,t,r){this.agentIdentifier=e,this.aggregator=t,this.ee=i.ee.get(e,(0,n.OP)(this.agentIdentifier).isolatedBacklog),this.featureName=r,this.blocked=!1,this.checkConfiguration()}checkConfiguration(){if(!(0,n.lF)(this.agentIdentifier)){let e={...(0,a.gG)().info?.jsAttributes};try{e={...e,...(0,n.C5)(this.agentIdentifier)?.jsAttributes}}catch(e){}(0,o.j)(this.agentIdentifier,{...(0,a.gG)(),info:{...(0,a.gG)().info,jsAttributes:e}})}}}},2384:(e,t,r)=>{"use strict";r.d(t,{j:()=>w});var n=r(2325),i=r(27),o=r(9252),a=r(3752),s=r(2053),c=r(4329),u=r(2650),d=r(2374),f=r(8610),l=r(6034),g=r(6797),h=r(2400);const p="CUSTOM/";function v(){const e=(0,g.gG)();["setErrorHandler","finished","addToTrace","inlineHit","addRelease","addPageAction","setCurrentRouteName","setPageViewName","setCustomAttribute","interaction","noticeError","setUserId"].forEach((t=>{e[t]=function(){for(var r=arguments.length,n=new Array(r),i=0;i<r;i++)n[i]=arguments[i];return function(t){for(var r=arguments.length,n=new Array(r>1?r-1:0),i=1;i<r;i++)n[i-1]=arguments[i];let o=[];return Object.values(e.initializedAgents).forEach((e=>{e.exposed&&e.api[t]&&o.push(e.api[t](...n))})),o.length>1?returnsVals:o[0]}(t,...n)}}))}var m=r(7022);const b={stn:[n.D.sessionTrace],err:[n.D.jserrors,n.D.metrics],ins:[n.D.pageAction],spa:[n.D.spa]};const y={};function w(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{},w=arguments.length>2?arguments[2]:void 0,A=arguments.length>3?arguments[3]:void 0,{init:x,info:j,loader_config:_,runtime:D={loaderType:w},exposed:E=!0}=t;const k=(0,g.gG)();if(j||(x=k.init,j=k.info,_=k.loader_config),j.jsAttributes??={},d.v6&&(j.jsAttributes.isWorker=!0),d.il){let e=(0,h.J8)(p);Object.assign(j.jsAttributes,e)}(0,i.CX)(e,j),(0,i.Dg)(e,x||{}),(0,i.GE)(e,_||{}),(0,i.sU)(e,D),v();const S=function(e,t){t||(0,c.R)(e,"api");const g={};var v=a.ee.get(e),m=v.get("tracer"),b="api-",y=b+"ixn-";function w(t,r,n,o){const a=(0,i.C5)(e);return null===r?(delete a.jsAttributes[t],d.il&&(0,h.GD)(t,p)):((0,i.CX)(e,{...a,jsAttributes:{...a.jsAttributes,[t]:r}}),d.il&&o&&(0,h.ju)(t,r,p)),j(b,n,!0)()}function A(){}["setErrorHandler","finished","addToTrace","inlineHit","addRelease"].forEach((e=>g[e]=j(b,e,!0,"api"))),g.addPageAction=j(b,"addPageAction",!0,n.D.pageAction),g.setCurrentRouteName=j(b,"routeName",!0,n.D.spa),g.setPageViewName=function(t,r){if("string"==typeof t)return"/"!==t.charAt(0)&&(t="/"+t),(0,i.OP)(e).customTransaction=(r||"http://custom.transaction")+t,j(b,"setPageViewName",!0)()},g.setCustomAttribute=function(e,t){let r=arguments.length>2&&void 0!==arguments[2]&&arguments[2];if("string"==typeof e){if(["string","number"].includes(typeof t)||null===t)return w(e,t,"setCustomAttribute",r);(0,f.Z)("Failed to execute setCustomAttribute.\nNon-null value must be a string or number type, but a type of <".concat(typeof t,"> was provided."))}else(0,f.Z)("Failed to execute setCustomAttribute.\nName must be a string type, but a type of <".concat(typeof e,"> was provided."))},g.setUserId=function(e){if("string"==typeof e||null===e)return w("enduser.id",e,"setUserId",!0);(0,f.Z)("Failed to execute setUserId.\nNon-null value must be a string type, but a type of <".concat(typeof e,"> was provided."))},g.interaction=function(){return(new A).get()};var x=A.prototype={createTracer:function(e,t){var r={},i=this,a="function"==typeof t;return(0,o.p)(y+"tracer",[(0,s.z)(),e,r],i,n.D.spa,v),function(){if(m.emit((a?"":"no-")+"fn-start",[(0,s.z)(),i,a],r),a)try{return t.apply(this,arguments)}catch(e){throw m.emit("fn-err",[arguments,this,"string"==typeof e?new Error(e):e],r),e}finally{m.emit("fn-end",[(0,s.z)()],r)}}}};function j(e,t,r,i){return function(){return(0,o.p)(l.xS,["API/"+t+"/called"],void 0,n.D.metrics,v),i&&(0,o.p)(e+t,[(0,s.z)(),...arguments],r?null:this,i,v),r?void 0:this}}function _(){r.e(439).then(r.bind(r,5692)).then((t=>{let{setAPI:r}=t;r(e),(0,c.L)(e,"api")})).catch((()=>(0,f.Z)("Downloading runtime APIs failed...")))}return["actionText","setName","setAttribute","save","ignore","onEnd","getContext","end","get"].forEach((e=>{x[e]=j(y,e,void 0,n.D.spa)})),g.noticeError=function(e,t){"string"==typeof e&&(e=new Error(e)),(0,o.p)(l.xS,["API/noticeError/called"],void 0,n.D.metrics,v),(0,o.p)("err",[e,(0,s.z)(),!1,t],void 0,n.D.jserrors,v)},d.v6?_():(0,u.b)((()=>_()),!0),g}(e,A);return(0,g.Qy)(e,S,"api"),(0,g.Qy)(e,E,"exposed"),(0,g.EZ)("activatedFeatures",y),(0,g.EZ)("setToken",(t=>function(e,t){var r=a.ee.get(t);e&&"object"==typeof e&&((0,m.D)(e,(function(e,t){if(!t)return(b[e]||[]).forEach((t=>{(0,o.p)("block-"+e,[],void 0,t,r)}));y[e]||((0,o.p)("feat-"+e,[],void 0,b[e],r),y[e]=!0)})),(0,c.L)(t,n.D.pageViewEvent))}(t,e))),S}},909:(e,t,r)=>{"use strict";r.d(t,{Z:()=>i,q:()=>o});var n=r(2325);function i(e){switch(e){case n.D.ajax:return[n.D.jserrors];case n.D.sessionTrace:return[n.D.ajax,n.D.pageViewEvent];case n.D.pageViewTiming:return[n.D.pageViewEvent];default:return[]}}function o(e){return e===n.D.jserrors?[]:["auto"]}},2325:(e,t,r)=>{"use strict";r.d(t,{D:()=>n,p:()=>i});const n={ajax:"ajax",jserrors:"jserrors",metrics:"metrics",pageAction:"page_action",pageViewEvent:"page_view_event",pageViewTiming:"page_view_timing",sessionTrace:"session_trace",spa:"spa"},i={[n.pageViewEvent]:1,[n.pageViewTiming]:2,[n.metrics]:3,[n.jserrors]:4,[n.ajax]:5,[n.sessionTrace]:6,[n.pageAction]:7,[n.spa]:8}},8683:e=>{e.exports=function(e,t,r){t||(t=0),void 0===r&&(r=e?e.length:0);for(var n=-1,i=r-t||0,o=Array(i<0?0:i);++n<i;)o[n]=e[t+n];return o}}},n={};function i(e){var t=n[e];if(void 0!==t)return t.exports;var o=n[e]={exports:{}};return r[e](o,o.exports,i),o.exports}i.m=r,i.n=e=>{var t=e&&e.__esModule?()=>e.default:()=>e;return i.d(t,{a:t}),t},i.d=(e,t)=>{for(var r in t)i.o(t,r)&&!i.o(e,r)&&Object.defineProperty(e,r,{enumerable:!0,get:t[r]})},i.f={},i.e=e=>Promise.all(Object.keys(i.f).reduce(((t,r)=>(i.f[r](e,t),t)),[])),i.u=e=>(({78:"page_action-aggregate",147:"metrics-aggregate",193:"session_trace-aggregate",317:"jserrors-aggregate",348:"page_view_timing-aggregate",439:"async-api",729:"lazy-loader",786:"page_view_event-aggregate",873:"spa-aggregate",898:"ajax-aggregate"}[e]||e)+"."+{78:"4d79b951",147:"20a08804",193:"6e2218bf",317:"9136a849",348:"9590bdab",439:"6c072bf7",729:"ff971c03",786:"75812140",862:"9f44b58b",873:"6c038a0a",898:"bcd562bf"}[e]+"-1.230.0.min.js"),i.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),e={},t="NRBA:",i.l=(r,n,o,a)=>{if(e[r])e[r].push(n);else{var s,c;if(void 0!==o)for(var u=document.getElementsByTagName("script"),d=0;d<u.length;d++){var f=u[d];if(f.getAttribute("src")==r||f.getAttribute("data-webpack")==t+o){s=f;break}}s||(c=!0,(s=document.createElement("script")).charset="utf-8",s.timeout=120,i.nc&&s.setAttribute("nonce",i.nc),s.setAttribute("data-webpack",t+o),s.src=r),e[r]=[n];var l=(t,n)=>{s.onerror=s.onload=null,clearTimeout(g);var i=e[r];if(delete e[r],s.parentNode&&s.parentNode.removeChild(s),i&&i.forEach((e=>e(n))),t)return t(n)},g=setTimeout(l.bind(null,void 0,{type:"timeout",target:s}),12e4);s.onerror=l.bind(null,s.onerror),s.onload=l.bind(null,s.onload),c&&document.head.appendChild(s)}},i.r=e=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},i.p="https://js-agent.newrelic.com/",(()=>{var e={30:0,768:0};i.f.j=(t,r)=>{var n=i.o(e,t)?e[t]:void 0;if(0!==n)if(n)r.push(n[2]);else{var o=new Promise(((r,i)=>n=e[t]=[r,i]));r.push(n[2]=o);var a=i.p+i.u(t),s=new Error;i.l(a,(r=>{if(i.o(e,t)&&(0!==(n=e[t])&&(e[t]=void 0),n)){var o=r&&("load"===r.type?"missing":r.type),a=r&&r.target&&r.target.src;s.message="Loading chunk "+t+" failed.\n("+o+": "+a+")",s.name="ChunkLoadError",s.type=o,s.request=a,n[1](s)}}),"chunk-"+t,t)}};var t=(t,r)=>{var n,o,[a,s,c]=r,u=0;if(a.some((t=>0!==e[t]))){for(n in s)i.o(s,n)&&(i.m[n]=s[n]);if(c)c(i)}for(t&&t(r);u<a.length;u++)o=a[u],i.o(e,o)&&e[o]&&e[o][0](),e[o]=0},r=window.webpackChunkNRBA=window.webpackChunkNRBA||[];r.forEach(t.bind(null,0)),r.push=t.bind(null,r.push.bind(r))})();var o={};(()=>{"use strict";i.r(o);var e=i(2325),t=i(27);const r=Object.values(e.D);function n(e){const n={};return r.forEach((r=>{n[r]=function(e,r){return!1!==(0,t.Mt)(r,"".concat(e,".enabled"))}(r,e)})),n}var a=i(2384),s=i(909),c=i(9252),u=i(8768),d=i(4329),f=i(1509),l=i(2650),g=i(2374),h=i(8610);class p extends f.W{constructor(e,t,r){let n=!(arguments.length>3&&void 0!==arguments[3])||arguments[3];super(e,t,r),this.hasAggregator=!1,this.auto=n,this.abortHandler,n&&(0,d.R)(e,r)}importAggregator(){if(this.hasAggregator||!this.auto)return;this.hasAggregator=!0;const e=async()=>{try{const{lazyLoader:e}=await i.e(729).then(i.bind(i,8110)),{Aggregate:t}=await e(this.featureName,"aggregate");new t(this.agentIdentifier,this.aggregator)}catch(e){(0,h.Z)("Downloading ".concat(this.featureName," failed...")),this.abortHandler?.()}};g.v6?e():(0,l.b)((()=>e()),!0)}}var v=i(2484),m=i(2053);class b extends p{static featureName=v.t9;constructor(r,n){let i=!(arguments.length>2&&void 0!==arguments[2])||arguments[2];if(super(r,n,v.t9,i),("undefined"==typeof PerformanceNavigationTiming||u.T)&&"undefined"!=typeof PerformanceTiming){const n=(0,t.OP)(r);n[v.Dz]=Math.max(Date.now()-n.offset,0),(0,l.K)((()=>n[v.qw]=Math.max((0,m.z)()-n[v.Dz],0))),(0,l.b)((()=>{const t=(0,m.z)();n[v.OJ]=Math.max(t-n[v.Dz],0),(0,c.p)("timing",["load",t],void 0,e.D.pageViewTiming,this.ee)}))}this.importAggregator()}}var y=i(9557),w=i(7022);class A extends y.w{constructor(e){super(e),this.aggregatedData={}}store(e,t,r,n,i){var o=this.getBucket(e,t,r,i);return o.metrics=function(e,t){t||(t={count:0});return t.count+=1,(0,w.D)(e,(function(e,r){t[e]=x(r,t[e])})),t}(n,o.metrics),o}merge(e,t,r,n,i){var o=this.getBucket(e,t,n,i);if(o.metrics){var a=o.metrics;a.count+=r.count,(0,w.D)(r,(function(e,t){if("count"!==e){var n=a[e],i=r[e];i&&!i.c?a[e]=x(i.t,n):a[e]=function(e,t){if(!t)return e;t.c||(t=j(t.t));return t.min=Math.min(e.min,t.min),t.max=Math.max(e.max,t.max),t.t+=e.t,t.sos+=e.sos,t.c+=e.c,t}(i,a[e])}}))}else o.metrics=r}storeMetric(e,t,r,n){var i=this.getBucket(e,t,r);return i.stats=x(n,i.stats),i}getBucket(e,t,r,n){this.aggregatedData[e]||(this.aggregatedData[e]={});var i=this.aggregatedData[e][t];return i||(i=this.aggregatedData[e][t]={params:r||{}},n&&(i.custom=n)),i}get(e,t){return t?this.aggregatedData[e]&&this.aggregatedData[e][t]:this.aggregatedData[e]}take(e){for(var t={},r="",n=!1,i=0;i<e.length;i++)t[r=e[i]]=_(this.aggregatedData[r]),t[r].length&&(n=!0),delete this.aggregatedData[r];return n?t:null}}function x(e,t){return null==e?function(e){e?e.c++:e={c:1};return e}(t):t?(t.c||(t=j(t.t)),t.c+=1,t.t+=e,t.sos+=e*e,e>t.max&&(t.max=e),e<t.min&&(t.min=e),t):{t:e}}function j(e){return{t:e,min:e,max:e,sos:e*e,c:1}}function _(e){return"object"!=typeof e?[]:(0,w.D)(e,D)}function D(e,t){return t}var E=i(6797),k=i(5526),S=i(2438);var P=i(6998),I=i(8544),T=i(6382);class N extends p{static featureName=T.t;constructor(e,r){let n=!(arguments.length>2&&void 0!==arguments[2])||arguments[2];super(e,r,T.t,n),g.il&&((0,t.OP)(e).initHidden=Boolean("hidden"===document.visibilityState),(0,P.N)((()=>(0,c.p)("docHidden",[(0,m.z)()],void 0,T.t,this.ee)),!0),(0,I.bP)("pagehide",(()=>(0,c.p)("winPagehide",[(0,m.z)()],void 0,T.t,this.ee))),this.importAggregator())}}const O=Boolean(g._A?.Worker),C=Boolean(g._A?.SharedWorker),R=Boolean(g._A?.navigator?.serviceWorker);let M,B,W;var z=i(6034),q=i(3752),L=i(8683),V=i.n(L);const Z="nr@original";var U=Object.prototype.hasOwnProperty,F=!1;function G(e,t){return e||(e=q.ee),r.inPlace=function(e,t,n,i,o){n||(n="");var a,s,c,u="-"===n.charAt(0);for(c=0;c<t.length;c++)Q(a=e[s=t[c]])||(e[s]=r(a,u?s+n:n,i,s,o))},r.flag=Z,r;function r(t,r,i,o,a){return Q(t)?t:(r||(r=""),nrWrapper[Z]=t,X(t,nrWrapper,e),nrWrapper);function nrWrapper(){var s,c,u,d;try{c=this,s=V()(arguments),u="function"==typeof i?i(s,c):i||{}}catch(t){H([t,"",[s,c,o],u],e)}n(r+"start",[s,c,o],u,a);try{return d=t.apply(c,s)}catch(e){throw n(r+"err",[s,c,e],u,a),e}finally{n(r+"end",[s,c,d],u,a)}}}function n(r,n,i,o){if(!F||t){var a=F;F=!0;try{e.emit(r,n,i,t,o)}catch(t){H([t,r,n,i],e)}F=a}}}function H(e,t){t||(t=q.ee);try{t.emit("internal-error",e)}catch(e){}}function X(e,t,r){if(Object.defineProperty&&Object.keys)try{return Object.keys(e).forEach((function(r){Object.defineProperty(t,r,{get:function(){return e[r]},set:function(t){return e[r]=t,t}})})),t}catch(e){H([e],r)}for(var n in e)U.call(e,n)&&(t[n]=e[n]);return t}function Q(e){return!(e&&e instanceof Function&&e.apply&&!e[Z])}const K={},J=["debug","error","info","log","trace","warn"];function Y(e){const t=function(e){return(e||q.ee).get("console")}(e);return K[t.debugId]||(K[t.debugId]=!0,G(t).inPlace(g._A.console,J,"-console-")),t}i(3916);XMLHttpRequest;g._A.Request,g._A.Response;class $ extends p{static featureName=z.t9;constructor(t,r){let n=!(arguments.length>2&&void 0!==arguments[2])||arguments[2];super(t,r,z.t9,n),function(e){if(!M){if(O){M=Worker;try{g._A.Worker=r(M,"Dedicated")}catch(e){o(e,"Dedicated")}if(C){B=SharedWorker;try{g._A.SharedWorker=r(B,"Shared")}catch(e){o(e,"Shared")}}else n("Shared");if(R){W=navigator.serviceWorker.register;try{g._A.navigator.serviceWorker.register=(t=W,function(){for(var e=arguments.length,r=new Array(e),n=0;n<e;n++)r[n]=arguments[n];return i("Service",r[1]?.type),t.apply(navigator.serviceWorker,r)})}catch(e){o(e,"Service")}}else n("Service");var t;return}n("All")}function r(e,t){return"undefined"==typeof Proxy?e:new Proxy(e,{construct:(e,r)=>(i(t,r[1]?.type),new e(...r))})}function n(t){g.v6||e("Workers/".concat(t,"/Unavailable"))}function i(t,r){e("Workers/".concat(t,"module"===r?"/Module":"/Classic"))}function o(t,r){e("Workers/".concat(r,"/SM/Unsupported")),(0,h.Z)("NR Agent: Unable to capture ".concat(r," workers."),t)}}((t=>(0,c.p)(z.xS,[t],void 0,e.D.metrics,this.ee))),this.addConsoleSupportabilityMetrics(),this.importAggregator()}addConsoleSupportabilityMetrics(){const t=Y(this.ee);for(const r of["Debug","Error","Info","Log","Trace","Warn"])t.on("".concat(r.toLowerCase(),"-console-start"),(function(n,i){let o=[];for(const e of n)"function"==typeof e||e&&e.message&&e.stack?o.push(e.toString()):o.push(e);const a=(0,S.P)(o);(0,c.p)(z.xS,["Console/".concat(r,"/Seen"),a.length],void 0,e.D.metrics,t)}))}}new class{constructor(e){let t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:(0,k.ky)(16);this.agentIdentifier=t,this.sharedAggregator=new A({agentIdentifier:this.agentIdentifier}),this.features={},this.desiredFeatures=new Set(e.features||[]),this.desiredFeatures.add(b),Object.assign(this,(0,a.j)(this.agentIdentifier,e,e.loaderType||"agent")),this.start()}get config(){return{info:(0,t.C5)(this.agentIdentifier),init:(0,t.P_)(this.agentIdentifier),loader_config:(0,t.DL)(this.agentIdentifier),runtime:(0,t.OP)(this.agentIdentifier)}}start(){const t="features";try{const r=n(this.agentIdentifier),i=Array.from(this.desiredFeatures);i.sort(((t,r)=>e.p[t.featureName]-e.p[r.featureName])),i.forEach((t=>{if(r[t.featureName]||t.featureName===e.D.pageViewEvent){const e=(0,s.Z)(t.featureName);e.every((e=>r[e]))||(0,h.Z)("".concat(t.featureName," is enabled but one or more dependent features has been disabled (").concat((0,S.P)(e),"). This may cause unintended consequences or missing data...")),this.features[t.featureName]=new t(this.agentIdentifier,this.sharedAggregator)}})),(0,E.Qy)(this.agentIdentifier,this.features,t)}catch(e){(0,h.Z)("Failed to initialize all enabled instrument classes (agent aborted) -",e);for(const e in this.features)this.features[e].abortHandler?.();const r=(0,E.fP)();return delete r.initializedAgents[this.agentIdentifier]?.api,delete r.initializedAgents[this.agentIdentifier]?.[t],delete this.sharedAggregator,r.ee?.abort(),delete r.ee?.get(this.agentIdentifier),!1}}}({features:[b,N,$],loaderType:"lite"})})(),window.NRBA=o})();</script><meta content="noindex" name="robots" /><script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyC0BuJ43Ncbmuro17vVxWJWrOzzAPZ0rQE&amp;libraries=places&amp;language=en"></script><link rel="stylesheet" media="screen" href="/assets/application-1e5a6017c873d97c5d5844e64ff5031a5e6183d183ad0a004cf6a15a8ba137a7.css" /><link rel="stylesheet" media="screen" href="/packs/css/4081-1044bc7f.css" />
  <link rel="stylesheet" media="screen" href="/packs/css/6188-50231742.css" />
  <link rel="stylesheet" media="screen" href="/packs/css/7454-f0d96ad9.css" />
  <link rel="stylesheet" media="screen" href="/packs/css/application-395dffc4.css" /><script src="/packs/js/runtime-854e05829e5ac6a73c42.js"></script>
  <script src="/packs/js/1761-689a3b9fd1d7f61a6602.js"></script>
  <script src="/packs/js/7297-9d4447e6ae6874a48ced.js"></script>
  <script src="/packs/js/2482-3e6a3d56a99ec4cf96b5.js"></script>
  <script src="/packs/js/3687-329b1f19feac4544afbf.js"></script>
  <script src="/packs/js/3921-dac94c0464d34976c95e.js"></script>
  <script src="/packs/js/4163-b4615f06dd1b835d3329.js"></script>
  <script src="/packs/js/4275-9f16d7d21f847803d1ff.js"></script>
  <script src="/packs/js/7399-725ce19fc749c03b9f9f.js"></script>
  <script src="/packs/js/4288-6235ebddef5772df226b.js"></script>
  <script src="/packs/js/4154-6ecb4fd696394376c851.js"></script>
  <script src="/packs/js/554-9d0a90c09f5caccc5634.js"></script>
  <script src="/packs/js/5470-d3e6b16e1214a43ccb89.js"></script>
  <script src="/packs/js/8873-0bd271aae83f52cb3caa.js"></script>
  <script src="/packs/js/7438-14d9a6011a3be8b4d922.js"></script>
  <script src="/packs/js/5770-cb2b8585220d263b0dda.js"></script>
  <script src="/packs/js/7429-22deb32463a5b6231449.js"></script>
  <script src="/packs/js/1349-538de172cd2b62969ded.js"></script>
  <script src="/packs/js/5219-577c1ea86d98bba4128c.js"></script>
  <script src="/packs/js/8243-219f306e81c28add1561.js"></script>
  <script src="/packs/js/6183-c22d78630ecf5b3cd9e0.js"></script>
  <script src="/packs/js/1427-8ba361ca3eedfc4223fe.js"></script>
  <script src="/packs/js/9240-981b8b896a9278e0cbf9.js"></script>
  <script src="/packs/js/844-b8e74c0cd4028f594c93.js"></script>
  <script src="/packs/js/5190-76575a547ab3604fb2aa.js"></script>
  <script src="/packs/js/8005-e0bc9aa7364ea7a80729.js"></script>
  <script src="/packs/js/5924-808f2cfcb6db92812bf3.js"></script>
  <script src="/packs/js/9873-becf8a5bb2c6442c989a.js"></script>
  <script src="/packs/js/6074-4c993b38d9503c4272dd.js"></script>
  <script src="/packs/js/8413-b0c9517f7fce17a1b9cb.js"></script>
  <script src="/packs/js/3610-6eaaacb9bd375fe0a3b7.js"></script>
  <script src="/packs/js/1814-7050be1da4918dbaeb12.js"></script>
  <script src="/packs/js/2949-09b991988c07646782ab.js"></script>
  <script src="/packs/js/4081-7c24f71981e00d43e36d.js"></script>
  <script src="/packs/js/4572-24881d80615959dd4435.js"></script>
  <script src="/packs/js/635-ded99b4fbaa85ab5950c.js"></script>
  <script src="/packs/js/999-6d7113b8f1b66ef0ee04.js"></script>
  <script src="/packs/js/4919-15ad9a68aa782bb6ae31.js"></script>
  <script src="/packs/js/6188-424b6e9097a93be38834.js"></script>
  <script src="/packs/js/7454-f0193a54ebcb2f1b48da.js"></script>
  <script src="/packs/js/7675-16d22ef3c6628a3ff0ea.js"></script>
  <script src="/packs/js/application-9b23474b577395cd7d39.js"></script><script src="/assets/application-91ccbe93ad65b0cf8d1e0b94248456ffb124e16941119e9979793c87aa6abb23.js"></script><meta name="csrf-param" content="authenticity_token" />
  <meta name="csrf-token" content="MZXjvOwNCkK4RydNO7p30-uQwbQKiGS8788ICbXngGzrArdvr6G-ADDXqu-mPM7l0KSePRstwWY1NfBriFjcMw" /></head><body class="home index"><div id="Navbar-react-component-460db06a-bafe-4158-bd55-200992503445"></div>
		<script type="application/json" class="js-react-on-rails-component" data-component-name="Navbar" data-dom-id="Navbar-react-component-460db06a-bafe-4158-bd55-200992503445">{"navMenus":{"left":[{"name":"Community","icon":"ion-md-people","badge_content":null,"entries":[{"name":"Forum","icon":"ion-md-chatboxes","path":"/channels/all"},{"name":"Company Directory","icon":"ion-md-briefcase","path":"/directory"},{"name":"Founder Directory","icon":"ion-md-contacts","path":"/directory/founders"},{"name":"Founder Navigator (Beta)","icon":"ion-md-compass","path":"/navigator"},{"name":"Batch W2021","icon":"ion-ios-people","path":"/batches/w2021"},{"name":"Group 3","icon":"ion-ios-return-right","path":"/batches/w2021#group-3"},{"name":"Alumni Demo Day","icon":"ion-md-bonfire","path":"/directory/demo_day"},{"name":"Launch YC","icon":"ion-ios-megaphone","path":"https://www.ycombinator.com/launches"},{"name":"YC Top Companies","icon":"ion-ios-trending-up-outline","path":"https://www.ycombinator.com/topcompanies"},{"name":"Non-YC Companies","icon":"ion-ios-globe","path":"/directory/non_yc_directory"},{"name":"YC Store","icon":"ion-ios-shirt","path":"https://shop.gemnote.com/yc/shop"},{"name":"Alumni Groups","icon":"ion-ios-chatbubbles-outline","path":"/knowledge/9m-online-alumni-groups"},{"name":"This week at YC","icon":"ion-ios-information-circle-outline","path":"https://us7.campaign-archive.com/home/?u=6507bf4e4c2df3fdbae6ef738\u0026id=547725049b"}]},{"name":"Resources","icon":"ion-ios-book","entries":[{"name":"User Manual","icon":"ion-ios-bookmarks-outline","path":"/knowledge/1T-yc-user-manual"},{"name":"Batch Schedule","icon":"ion-md-calendar","path":"/schedule"},{"name":"Deals","icon":"ion-md-card","path":"/deals"},{"name":"Professional Services Directory","icon":"ion-md-people","path":"/professional_services"},{"name":"Fundraising Trends","icon":"ion-ios-stats","path":"/trends"},{"name":"Investor Database","icon":"ion-logo-usd","path":"/directory/investors?year=%5B2019%2C+2023%5D"},{"name":"Startup Library","icon":"ion-ios-book-outline","path":"https://ycombinator.com/library"},{"name":"Series A Manual","icon":"ion-ios-compass","path":"/knowledge/FI-series-a-manual"},{"name":"Admissions","icon":"ion-ios-school","path":"/knowledge/Go-yc-admissions"},{"name":"Knowledge Base","icon":"ion-md-globe","path":"/knowledge"},{"name":"Bookface Companion","icon":"ion-logo-chrome","path":"/knowledge/Em-bookface-companion"},{"name":"My Lists","icon":"ion-ios-list-box-outline","path":"/lists"}]},{"name":"Contact YC","icon":"ion-logo-hackernews","entries":[{"name":"Book Office Hours","icon":"ion-md-bookmarks","path":"/booker"},{"name":"Financings \u0026 Transactions","icon":"ion-md-cash","path":"/knowledge/Bp-notify-yc-financings-transactions"},{"name":"People at YC","icon":"ion-md-people","path":"/yc"},{"name":"Report Bad Actors","icon":"ion-md-sad","path":"https://docs.google.com/forms/d/e/1FAIpQLSf1BT_28VFKQS-AQm9XKA238-o2WBT90Um3PnD0xSg5UBx-XQ/viewform"},{"name":"Recommend Startups","icon":"ion-md-person-add","path":"https://apply.ycombinator.com/recommendations"},{"name":"Email Us","icon":"ion-ios-mail","path":"mailto:software@ycombinator.com"},{"name":"Privacy Policy","icon":"ion-ios-information-circle","path":"https://www.ycombinator.com/legal#privacy"}]},{"name":"Recruiting","icon":"ion-md-person-add","entries":[{"name":"Dashboard","icon":"ion-ios-home","path":"/workatastartup/dashboard"},{"name":"Source","icon":"ion-ios-contacts","path":"/workatastartup/applicants"},{"name":"Inbox","icon":"ion-ios-mail","path":"/workatastartup/inbox","waas_unread_inbox":true},{"name":"Applicants","icon":"ion-ios-hand","path":"/workatastartup/applied","waas_unread_applied":true},{"name":"Jobs","icon":"ion-md-document","path":"/company/23105/jobs","badge_content":null}],"waas_unread_inbox":true},{"name":"Company","icon":"ion-md-briefcase","entries":[{"name":"Questbook","icon":"ion-md-briefcase","path":"/company/23105"},{"name":"Investments","icon":"ion-ios-return-right","path":"/company/23105/investments"},{"name":"Demo Day Leads","icon":"ion-ios-return-right","path":"/company/23105/demo_day_investors"},{"name":"Rate your investors","icon":"ion-ios-return-right","path":"/investor_grades"},{"name":"Company Updates","icon":"ion-ios-return-right","path":"/companies/23155/company_updates"}]}],"right":[{"name":"werwer","icon":"ion-md-contact","type":"user","entries":[{"name":"My Profile","icon":"ion-md-contact","path":"/user/182853"},{"name":"Forum Notifications","icon":"ion-md-notifications","path":"/forum/notifications"},{"name":"Forum Keyword Alerts","icon":"ion-md-headset","path":"/forum_alerts"},{"name":"Log Out","icon":"ion-md-log-out","path":"/session/logout"}]}]},"brandImageUrl":"https://bookface.ycombinator.com/assets/ycombinator-logo-7481412385fe6d0f7d4a3339d90fe12309432ca41983e8d350b232301d5d8684.png","brandHref":"https://bookface.ycombinator.com/home","currentUser":{"avatarThumbUrl":"https://bookface-images.s3.amazonaws.com/avatars/a5c05c087cf0b25cf0e08654e2d95128e379b7ec.jpg"},"currentPath":"/home","searchVisible":true,"subnav":null,"inWaas":false,"waasHref":"https://bookface.ycombinator.com/workatastartup/dashboard","hasBookface":true,"loggedIn":true,"releaseNotes":{"notes":[],"type":"bookface","since":null},"borderType":"None"}</script>
		
  <div id="Search-react-component-76e03c44-d86c-409e-b85c-5fb08597ec31"></div>
		<script type="application/json" class="js-react-on-rails-component" data-component-name="Search" data-dom-id="Search-react-component-76e03c44-d86c-409e-b85c-5fb08597ec31">{"waas":false,"siteNav":{"left":[{"name":"Community","icon":"ion-md-people","badge_content":null,"entries":[{"name":"Forum","icon":"ion-md-chatboxes","path":"/channels/all"},{"name":"Company Directory","icon":"ion-md-briefcase","path":"/directory"},{"name":"Founder Directory","icon":"ion-md-contacts","path":"/directory/founders"},{"name":"Founder Navigator (Beta)","icon":"ion-md-compass","path":"/navigator"},{"name":"Batch W2021","icon":"ion-ios-people","path":"/batches/w2021"},{"name":"Group 3","icon":"ion-ios-return-right","path":"/batches/w2021#group-3"},{"name":"Alumni Demo Day","icon":"ion-md-bonfire","path":"/directory/demo_day"},{"name":"Launch YC","icon":"ion-ios-megaphone","path":"https://www.ycombinator.com/launches"},{"name":"YC Top Companies","icon":"ion-ios-trending-up-outline","path":"https://www.ycombinator.com/topcompanies"},{"name":"Non-YC Companies","icon":"ion-ios-globe","path":"/directory/non_yc_directory"},{"name":"YC Store","icon":"ion-ios-shirt","path":"https://shop.gemnote.com/yc/shop"},{"name":"Alumni Groups","icon":"ion-ios-chatbubbles-outline","path":"/knowledge/9m-online-alumni-groups"},{"name":"This week at YC","icon":"ion-ios-information-circle-outline","path":"https://us7.campaign-archive.com/home/?u=6507bf4e4c2df3fdbae6ef738\u0026id=547725049b"}]},{"name":"Resources","icon":"ion-ios-book","entries":[{"name":"User Manual","icon":"ion-ios-bookmarks-outline","path":"/knowledge/1T-yc-user-manual"},{"name":"Batch Schedule","icon":"ion-md-calendar","path":"/schedule"},{"name":"Deals","icon":"ion-md-card","path":"/deals"},{"name":"Professional Services Directory","icon":"ion-md-people","path":"/professional_services"},{"name":"Fundraising Trends","icon":"ion-ios-stats","path":"/trends"},{"name":"Investor Database","icon":"ion-logo-usd","path":"/directory/investors?year=%5B2019%2C+2023%5D"},{"name":"Startup Library","icon":"ion-ios-book-outline","path":"https://ycombinator.com/library"},{"name":"Series A Manual","icon":"ion-ios-compass","path":"/knowledge/FI-series-a-manual"},{"name":"Admissions","icon":"ion-ios-school","path":"/knowledge/Go-yc-admissions"},{"name":"Knowledge Base","icon":"ion-md-globe","path":"/knowledge"},{"name":"Bookface Companion","icon":"ion-logo-chrome","path":"/knowledge/Em-bookface-companion"},{"name":"My Lists","icon":"ion-ios-list-box-outline","path":"/lists"}]},{"name":"Contact YC","icon":"ion-logo-hackernews","entries":[{"name":"Book Office Hours","icon":"ion-md-bookmarks","path":"/booker"},{"name":"Financings \u0026 Transactions","icon":"ion-md-cash","path":"/knowledge/Bp-notify-yc-financings-transactions"},{"name":"People at YC","icon":"ion-md-people","path":"/yc"},{"name":"Report Bad Actors","icon":"ion-md-sad","path":"https://docs.google.com/forms/d/e/1FAIpQLSf1BT_28VFKQS-AQm9XKA238-o2WBT90Um3PnD0xSg5UBx-XQ/viewform"},{"name":"Recommend Startups","icon":"ion-md-person-add","path":"https://apply.ycombinator.com/recommendations"},{"name":"Email Us","icon":"ion-ios-mail","path":"mailto:software@ycombinator.com"},{"name":"Privacy Policy","icon":"ion-ios-information-circle","path":"https://www.ycombinator.com/legal#privacy"}]},{"name":"Recruiting","icon":"ion-md-person-add","entries":[{"name":"Dashboard","icon":"ion-ios-home","path":"/workatastartup/dashboard"},{"name":"Source","icon":"ion-ios-contacts","path":"/workatastartup/applicants"},{"name":"Inbox","icon":"ion-ios-mail","path":"/workatastartup/inbox","waas_unread_inbox":true},{"name":"Applicants","icon":"ion-ios-hand","path":"/workatastartup/applied","waas_unread_applied":true},{"name":"Jobs","icon":"ion-md-document","path":"/company/23105/jobs","badge_content":null}],"waas_unread_inbox":true},{"name":"Company","icon":"ion-md-briefcase","entries":[{"name":"Questbook","icon":"ion-md-briefcase","path":"/company/23105"},{"name":"Investments","icon":"ion-ios-return-right","path":"/company/23105/investments"},{"name":"Demo Day Leads","icon":"ion-ios-return-right","path":"/company/23105/demo_day_investors"},{"name":"Rate your investors","icon":"ion-ios-return-right","path":"/investor_grades"},{"name":"Company Updates","icon":"ion-ios-return-right","path":"/companies/23155/company_updates"}]}],"right":[{"name":"wer","icon":"ion-md-contact","type":"user","entries":[{"name":"My Profile","icon":"ion-md-contact","path":"/user/182853"},{"name":"Forum Notifications","icon":"ion-md-notifications","path":"/forum/notifications"},{"name":"Forum Keyword Alerts","icon":"ion-md-headset","path":"/forum_alerts"},{"name":"Log Out","icon":"ion-md-log-out","path":"/session/logout"}]}]},"defaultQuery":null}</script>
		
  <div class="container page-body"><div class="content nomargin"><script type="application/json" id="js-react-on-rails-context">{"railsEnv":"production","inMailer":false,"i18nLocale":"en","i18nDefaultLocale":"en","rorVersion":"13.0.0","rorPro":false,"href":"https://bookface.ycombinator.com/home","location":"/home","scheme":"https","host":"bookface.ycombinator.com","port":null,"pathname":"/home","search":null,"httpAcceptLanguage":"en-US,en;q=0.9","applyBatchLong":"Summer 2023","applyBatchShort":"S2023","applyDeadlineShort":"April  7","ycdcRetroMode":false,"currentUser":{"id":182853,"admin":false,"waas_admin":false,"yc_partner":false,"current_company":{"name":"Questbook"},"company_for_deals":{"name":"Questbook"},"full_name":"qweqwe","first_name":"qwe","hnid":"qwe"},"serverSide":false}</script>
  <div id="HomePage-react-component-da3a44a5-f5a9-4034-bc29-92c963507ad6"></div>
		<script type="application/json" class="js-react-on-rails-component" data-component-name="HomePage" data-dom-id="HomePage-react-component-da3a44a5-f5a9-4034-bc29-92c963507ad6">{"currentUser":{"id":182853,"hnid":"qweqwe","full_name":"qwe qwe","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/a5c05c087cf0b25cf0e08654e2d95128e379b7ec.jpg","admin":false,"batch_location":false,"company":{"id":23105,"name":"Questbook","avatar":"https://bookface-images.s3.amazonaws.com/small_logos/76b4d06ff2e585b333f5f8c0fd3930367130db4e.png","active":true,"batch":{"short":"W21","long":"W2021","current":false}}},"userVotes":null,"onboardingStatus":null,"banner":{"cache_key":"0.6353781550327607","class_name":"","large":"","md":""},"events":[],"channels":[{"id":349709,"subscribed":true,"notifications":"digest","force_subscribed":true,"force_important_notifications":false,"display_as_restricted":false,"can_comment":false,"can_post":false,"archived":false,"name":"All Posts","description":"All posts from your channels.","slug":"all","type":null,"synthetic":true},{"id":349710,"subscribed":true,"notifications":"digest","force_subscribed":true,"force_important_notifications":false,"display_as_restricted":false,"can_comment":false,"can_post":false,"archived":false,"name":"⭐ Featured Posts","description":"Posts featured by forum admins.","slug":"featured","type":null,"synthetic":true},{"id":349711,"subscribed":true,"notifications":"important_immediate","force_subscribed":true,"force_important_notifications":false,"display_as_restricted":false,"can_comment":true,"can_post":false,"archived":false,"name":"YC Announcements","description":"Announcements (events, programs, content) relevant to the YC community.","slug":"announcements","type":null,"synthetic":false},{"id":349735,"subscribed":true,"notifications":"digest","force_subscribed":false,"force_important_notifications":false,"display_as_restricted":false,"can_comment":true,"can_post":true,"archived":false,"name":"General","description":"Technical or business learnings or questions, including requests for technical expertise, that would be relevant for a large number of YC companies.","slug":"general","type":null,"synthetic":false},{"id":528210,"subscribed":true,"notifications":"digest","force_subscribed":false,"force_important_notifications":false,"display_as_restricted":false,"can_comment":true,"can_post":true,"archived":false,"name":"Launch Bookface","description":"New products or features that you would like YC alumni to try.","slug":"launch_bookface","type":null,"synthetic":false},{"id":528211,"subscribed":true,"notifications":"digest","force_subscribed":false,"force_important_notifications":false,"display_as_restricted":false,"can_comment":true,"can_post":true,"archived":false,"name":"Classifieds","description":"Events, groups, side projects, introduction requests, requests for feedback or surveys, vendor or agency requests, items for sale, office space for lease.","slug":"classifieds","type":null,"synthetic":false},{"id":349754,"subscribed":true,"notifications":"digest","force_subscribed":false,"force_important_notifications":false,"display_as_restricted":false,"can_comment":true,"can_post":true,"archived":false,"name":"Recruiting","description":"Ask hiring questions, share candidate recommendations and post open jobs at active YC startups.","slug":"recruiting","type":null,"synthetic":false},{"id":349712,"subscribed":true,"notifications":"important_immediate","force_subscribed":true,"force_important_notifications":true,"display_as_restricted":true,"can_comment":true,"can_post":true,"archived":false,"name":"Batch W2021","description":"Questions or announcements that you would like just your batch-mates to see.","slug":"w2021","type":"batch","synthetic":false},{"id":349713,"subscribed":true,"notifications":"immediate","force_subscribed":true,"force_important_notifications":true,"display_as_restricted":true,"can_comment":true,"can_post":true,"archived":false,"name":"Group W2021-3","description":"Questions or announcements that you would like just your group-mates to see.","slug":"w2021_3","type":"batch_group","synthetic":false}],"announcements":[],"posts":[{"vote_info":{"current_user_vote":null,"count":16,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71262,"title":"Advice Scaling Kubernetes","body":"We're using Keda to scale our Kubernetes cluster up and down to match user demand throughout the day. \n\nBut with a lot of recent growth, we're coming close to a volume and frequency of activity that will overload Keda and, unfortunately, Keda's architecture does not allow us to simply scale it horizontally. \n\nWe are considering different strategies to address the problem, but we would love to chat with anyone who has experience auto-scaling k8s at high volumes. Thanks!\\\n\\\nDrop me a line at [rich@fathom.video](mailto:rich@fathom.video) or leave a comment below and I'll find you 🙂 \n\nThanks YC fam!","user":{"id":497830,"full_name":"Richard White","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/1d6ebbdda301f0db1c3de4d1094ebf025f2d4592.jpg","companies":[{"id":22879,"name":"Fathom","batch":"W21","url":"/company/22879","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/008e65b3fdfccde7a316a6c0911fd59301ff1025.png"}],"email":"rich@fathom.video","url":"/user/497830","badges":[],"trusted_answerer":false},"comment_count":2,"views_count":174,"state":"","channel":"general","url":"https://bookface.ycombinator.com/posts/71262","edit_url":"https://bookface.ycombinator.com/posts/71262","important":false,"created_at":"2023-04-28T23:11:04.550Z","pinned":false,"slug":"IXO-advice-scaling-kubernetes","all_tags":[]},{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71258,"title":"Making use of SKAN 4.0?","body":"Hey folks, is anyone already successfully making use of the new SKAN 4.0 features, such as the multiple postback windows, e.g. to report conversions to paid after a 7 day trial, and the better support for safari web to app store conversions for e.g. google search ads to app store? \n\nWe use AppsFlyer, and they rolled out their support for it recently and we're looking to update, but was hoping to hear if anyone else already took the plunge and how it's going. \n\nSomething else on my mind is "are Facebook and Google ready to support SKAN 4.0 yet as part of their campaign optimization?"\n\nIf anyone has any insight or wants to trade notes, DM or reply below :)","user":{"id":740607,"full_name":"Ilya Usorov","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/2259539f017cffde44733f871f90e7476ac3dfb6.jpg","companies":[{"id":24065,"name":"BoldVoice","batch":"S21","url":"/company/24065","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/b5efb6e4dabd2976ede40db2ef12a87efce69aa3.png"}],"email":"ilya@usorov.com","url":"/user/740607","badges":[],"trusted_answerer":false},"comment_count":0,"views_count":79,"state":"","channel":"general","url":"https://bookface.ycombinator.com/posts/71258","edit_url":"https://bookface.ycombinator.com/posts/71258","important":false,"created_at":"2023-04-28T17:00:35.857Z","pinned":false,"slug":"IXK-making-use-of-skan-4-0","all_tags":[]}],"comments":[],"launchBookfacePosts":[],"launchYCPosts":[],"recruitingPosts":[{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71266,"title":"Stellar devops engineer available for hire","body":"[Dushyant Mehta](https://www.linkedin.com/in/dmehta28/) is a great devops engineer and architect that was just laid off from Amazon during their latest round of layoffs. He worked for us at Qventus for more than five years and was a huge driver of our maturing infrastructure during that time. He holds himself to a high level of ownership and executes incredibly well in a startup environment.\n\nHe is based in Atlanta but prefers to work remotely. If you need help scaling your infrastructure and maturing your eng organization, Dushyant would be a great hire! If interested, please reach out to him directly at [dushyant.mehta28@gmail.com](mailto:dushyant.mehta28@gmail.com)","user":{"id":8044,"full_name":"Ian Christopher","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/b94f5d92b6c119af50130079c36007d4dd3f9a3e.jpg","companies":[{"id":740,"name":"Qventus","batch":"W15","url":"/company/740","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/1defe75646f1d3885f2a5762f45c3977246f4ec8.png"}],"email":"ian@qventus.com","url":"/user/8044","badges":[],"trusted_answerer":false},"comment_count":0,"views_count":31,"state":"","channel":"recruiting","url":"https://bookface.ycombinator.com/posts/71266","edit_url":"https://bookface.ycombinator.com/posts/71266","important":false,"created_at":"2023-04-29T05:20:26.845Z","pinned":false,"slug":"IXS-stellar-devops-engineer-available-for-hire","all_tags":[],"location":"Atlanta","rec_strength":"2","worked_together":true,"how_known":"Dushyant worked with us for 5+ years","discipline":"eng","waas_invite_email":"dushyant.mehta28@gmail.com"},{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71261,"title":"Recent law grad looking for opportunity in tech/startup","body":"Hey YC,\n\nMy wife recently relocated to San Francisco from Canada and is currently looking for a job. She has a JD from McGill and an BA in English from Brown University. If your company is looking for any help with legal stuff, she's a highly recommended candidate :)\n\n\u003chttps://www.linkedin.com/in/margcr/\u003e\n\nThx!","user":{"id":265839,"full_name":"Christian Mathiesen","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/f1a02aca7bf268e8a6f107251cac7301fdb7d5e8.jpg","companies":[{"id":27852,"name":"Frigade","batch":"W23","url":"/company/27852","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/ccd8e1e94fc54f293c3bd81a6c1d8b21ebc157b1.png"}],"email":"christian@frigade.com","url":"/user/265839","badges":[],"trusted_answerer":false},"comment_count":0,"views_count":47,"state":"","channel":"recruiting","url":"https://bookface.ycombinator.com/posts/71261","edit_url":"https://bookface.ycombinator.com/posts/71261","important":false,"created_at":"2023-04-28T23:00:11.706Z","pinned":false,"slug":"IXN-recent-law-grad-looking-for-opportunity-in-tech-startup","all_tags":[],"location":"","rec_strength":"","worked_together":null,"how_known":"","discipline":"","waas_invite_email":""},{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71259,"title":"Great Mechanical Designer looking for work","body":"If any of you need mechanical design support, I highly recommend [Michael McClain](https://www.linkedin.com/in/michael-mcclain/?locale=it_IT) who has done a ton of great work for us. He lives in Slovakia though grew up in Oregon and  communication with him has been excellent. He has been super organized and completes one task after the next. I've given him a fair bit of autonomy in coming up with solutions and have been pleased with the results. He does not have a mechanical engineering degree but designs as if he did, and his rates are lower than an ME. We've used [his services through Upwork](https://www.upwork.com/freelancers/\\~01052d50d552be0de4?referrer_url_path=%2Fab%2Fprofiles%2Fsearch%2Fdetails%2F\\~01052d50d552be0de4%2Fprofile) which has been easy.","user":{"id":740600,"full_name":"Nico Julian","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/d3f1e140517db6a6cf7b7fc4fe45a898989d2aa1.jpg","companies":[{"id":24759,"name":"Phykos","batch":"S21","url":"/company/24759","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/f4fae33c25ffd1357e90efd63adf09b81698da05.png"}],"email":"npjulian@gmail.com","url":"/user/740600","badges":[],"trusted_answerer":false},"comment_count":0,"views_count":34,"state":"","channel":"recruiting","url":"https://bookface.ycombinator.com/posts/71259","edit_url":"https://bookface.ycombinator.com/posts/71259","important":false,"created_at":"2023-04-28T17:32:40.128Z","pinned":false,"slug":"IXL-great-mechanical-designer-looking-for-work","all_tags":[],"location":"Slovakia","rec_strength":"2","worked_together":true,"how_known":"","discipline":"design","waas_invite_email":""},{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71256,"title":"Fantastic Commercial VP available","body":"If any of you are looking for a very strong commercial VP with strengths in BD, product planning as well as Competitive intelligence - I **strongly** recommend Peter Finlayson. Feel free to contact me for questions, or reach out to him directly.\n\nBrief Bio below:\n\n\u003e Peter is the Executive Director of Partnerships and Innovation for Pardes Biosciences in support of its lead asset, an oral antiviral to treat COVID-19. As a member of the Commercial Leadership Team, Peter defined the commercial launch strategy and execution plan for all elements of a broad, international launch. His responsibilities included both traditional and non-traditional Business Development, strategic partnerships, clinical trial enablement, demand forecasting, company valuation, market research, competitive intelligence, generic/brand naming, and more.\n\u003e\n\u003e Prior to Pardes, Peter spent almost 9 years at Genentech in roles of increasing responsibility. He was a Marketing Leader and led commercial launch planning \u0026 execution for multiple brands. He has deep U.S. market access expertise and experience in developing and executing novel distribution and contracting approaches to maximize patient access and reduce launch-related costs. Peter successfully worked in customer experience organizations implementing digital innovation solutions and processes that reduced time and costs of bringing new solutions to market. He thrives in regional \u0026 national account management roles working with providers, health systems, GPOs, distributors, and advocacy organizations. In addition to Infectious Disease, Peter has worked in Oncology, Ophthalmology, Multiple Sclerosis, Rare Disease, and Thrombolytics.\n\u003e\n\u003e Before joining Genentech, Peter worked for ZS Associates for nearly six years as a healthcare consultant where he honed his team and project management skills, as well as account management and consultative selling abilities. Peter supported dozens of BioPharma companies in exceeding their commercial goals in many therapeutic areas, and spanning across functional groups.\n\u003e\n\u003e Peter holds bachelor's and master's degrees from Stanford University. As a father of four boys, Peter stays very active in his local community as a coach on countless sports teams, and serving as bishop for his local church.","user":{"id":323931,"full_name":"Uri Lopatin","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/5778aaf0271d7d376bc1f3f639c7a6d72753d456.jpg","companies":[{"id":22111,"name":"Pardes Biosciences","batch":"S20","url":"/company/22111","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/7a90b132bd3ef57761690e68c3355e7471e2abf7.png"},{"id":64,"name":"Y Combinator","batch":"","url":"/company/64","former_company":true,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/2db694dd7905db37d037821a2fdaf9fa0708a964.png"}],"email":"uri@ycombinator.com","url":"/user/323931","badges":["yc_staff"],"trusted_answerer":false},"comment_count":0,"views_count":65,"state":"","channel":"recruiting","url":"https://bookface.ycombinator.com/posts/71256","edit_url":"https://bookface.ycombinator.com/posts/71256","important":false,"created_at":"2023-04-28T15:50:18.007Z","pinned":false,"slug":"IXI-fantastic-commercial-vp-available","all_tags":["Partnerships","business development","VP","competitive intelligence","commercialization"],"location":"Remote","rec_strength":"3","worked_together":true,"how_known":"Peter was a key member of our commercial team, reporting to our chief commercial officer.  He was excellent.  ","discipline":"marketing","waas_invite_email":"petefin@gmail.com"},{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71255,"title":"Stellar full-stack engineer (ex-FB, former founder) looking for new role","body":"Hi all,\n\nRecommending Shreyas, who's looking to join an early stage startup (seed/A/B preferred) as a full-stack engineer. He spent time at Facebook and was a former founder beforehand.\n\nHe's especially great with Python/React and is a terrific communicator, and someone who can do adjacent PM/design work when needed.\n\nPrefers NYC but open to SF and remote roles.\n\nYou can reach out at [shreyassood@gmail.com](mailto:shreyassood@gmail.com)!","user":{"id":217871,"full_name":"Bhavin Gupta","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/542515bdad75d8b1f3514d5c94a7aa59250c9de7.jpg","companies":[{"id":12631,"name":"Fynn","batch":"S19","url":"/company/12631","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/2130bc9129d6903e966a14272a2916b912d00d2e.png"}],"email":"bhavingpt@gmail.com","url":"/user/217871","badges":[],"trusted_answerer":false},"comment_count":0,"views_count":123,"state":"","channel":"recruiting","url":"https://bookface.ycombinator.com/posts/71255","edit_url":"https://bookface.ycombinator.com/posts/71255","important":false,"created_at":"2023-04-28T15:35:05.359Z","pinned":false,"slug":"IXH-stellar-full-stack-engineer-ex-fb-former-founder-looking-for-new-role","all_tags":[],"location":"NYC/San Francisco/Remote","rec_strength":"2","worked_together":false,"how_known":"Known them for the last 7 years","discipline":"eng","waas_invite_email":"shreyassood@gmail.com"}],"classifieds":[{"vote_info":{"current_user_vote":null,"count":1,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71265,"title":"Intro to someone at Welkin, Nabla, or Kareo","body":"Are there any founders here who have a contact at either [Welkin](https://welkinhealth.com/), [Nabla](https://www.nabla.com/), or [Kareo](https://www.kareo.com/)?\\\n\\\nWe're talking to potential customers who use these EHRs, and want to be able to offer our [Medical API](https://www.metriport.com/medical) as an integration through their platform, so our customers don't have to build around them.\\\n\\\nWould love to leverage a warm intro if anyone happens to know someone at these small-ish companies!","user":{"id":611194,"full_name":"Colin Elsinga","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/0d5eb4599804eeaebc6a92ba0735d0cb92ff3c46.jpg","companies":[{"id":27037,"name":"Metriport","batch":"S22","url":"/company/27037","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/d4da680d3cdee4cc7ad6408d3177026092f04c75.png"}],"email":"colin@metriport.com","url":"/user/611194","badges":[],"trusted_answerer":false},"comment_count":0,"views_count":23,"state":"","channel":"classifieds","url":"https://bookface.ycombinator.com/posts/71265","edit_url":"https://bookface.ycombinator.com/posts/71265","important":false,"created_at":"2023-04-29T01:25:03.604Z","pinned":false,"slug":"IXR-intro-to-someone-at-welkin-nabla-or-kareo","all_tags":[]},{"vote_info":{"current_user_vote":null,"count":3,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71264,"title":"Looking to chat with platform engineers/developer productivity engineers","body":"Hi friends! Has anyone here worked on a platform engineering team that's responsible for building Internal Developer Platforms? Specifically, I'm looking to talk to folks who have worked on teams which build self-service tools which take away the burden of building, deploying, scaling, and managing devops around their code. Google, Airbnb, Netflix, Uber, Stripe, to name a few all have such teams.\n\nWould love to chat with you and would appreciate intros to anyone you may know!","user":{"id":1098594,"full_name":"Jessie Young","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/bacd8dfbf932dba178be48e147deb56a5188e65c.jpg","companies":[{"id":27810,"name":"Cakework","batch":"W23","url":"/company/27810","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/c4dbd8d6bcbc396c907943226c3f01d2cbcd5809.png"}],"email":"jessie@cakework.com","url":"/user/1098594","badges":[],"trusted_answerer":false},"comment_count":1,"views_count":47,"state":"","channel":"classifieds","url":"https://bookface.ycombinator.com/posts/71264","edit_url":"https://bookface.ycombinator.com/posts/71264","important":false,"created_at":"2023-04-29T01:19:35.329Z","pinned":false,"slug":"IXQ-looking-to-chat-with-platform-engineers-developer-productivity-engineers","all_tags":[]},{"vote_info":{"current_user_vote":null,"count":0,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71263,"title":"Rippling Payroll Issue - anyone know how their \"clawback\" works or how we can avoid it?","body":"So I just found out from my controller that he forgot to wire funds from our operating account to our payroll account this week.\n\nAt 3:36PM PT today he got an email saying we needed to wire funds to Rippling by 11AM PT today, which raises … a bit of an issue seeing that the time had already passed.\n\nIt says they will begin clawing back employee funds if we did not do that which of course was not done.\n\nWe have the money in our payroll account now and can wire the funds but the wire deadline has passed so now I'm stuck wondering if employees will have their money clawed back on Monday?\n\nIs there anyone at [@Rippling](https://bookface.ycombinator.com/company/1451) that can tell us what we can do to avoid that happening?","user":{"id":886,"full_name":"Zach Bruhnke","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/a5d68ce2558580800f21597871d32e3076d485c5.jpg","companies":[{"id":62,"name":"Medmonk","batch":"W12","url":"/company/62","former_company":true,"logo_url":null}],"email":"z@zbruhnke.com","url":"/user/886","badges":[],"trusted_answerer":false},"comment_count":1,"views_count":103,"state":"","channel":"classifieds","url":"https://bookface.ycombinator.com/posts/71263","edit_url":"https://bookface.ycombinator.com/posts/71263","important":false,"created_at":"2023-04-28T23:33:23.252Z","pinned":false,"slug":"IXP-rippling-payroll-issue-anyone-know-how-their-clawback-works-or-how-we-can-avoid-it","all_tags":[]},{"vote_info":{"current_user_vote":null,"count":10,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71260,"title":"YC founder hoodies for sale ","body":"Hey all - We (Vastrm) had some left over fleece fabric that we made into YC hoodies.  There aren't many available only about 60 units in assorted sizes - 2 colors available.  It is a thicker fleece material vs the pique cotton we have used in the past.  Sizing is true to fit.  Size chart here: \u003chttp://www.vastrm.com/size-chart#\u003e  Cost is $95 (normally would retail for about $225 - I know expensive but we sell into high end boutique stores mainly.)  \n\n\u003chttps://vastrmsportswear.myshopify.com/products/fleece-yc-founders-hoodie?variant=42571111694513\u003e","user":{"id":30619,"full_name":"Jonathan Tang","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/2374146a4bbe9bbb25318ea23d2fecbfe9b11ec8.jpg","companies":[{"id":460,"name":"Vastrm","batch":"S12","url":"/company/460","former_company":false,"logo_url":null}],"email":"jtang@vastrm.com","url":"/user/30619","badges":[],"trusted_answerer":false},"comment_count":2,"views_count":352,"state":"","channel":"classifieds","url":"https://bookface.ycombinator.com/posts/71260","edit_url":"https://bookface.ycombinator.com/posts/71260","important":false,"created_at":"2023-04-28T21:35:37.167Z","pinned":false,"slug":"IXM-yc-founder-hoodies-for-sale","all_tags":[]},{"vote_info":{"current_user_vote":null,"count":1,"adjustment":false},"moderated_by":false,"featured_at":null,"id":71257,"title":"Bakar Labs hosting a happy hour on May 4th 5-7pm","body":"Courtesy of Gino Segre\n\n"Please join us for spring happy hour on **May 4, 2023, 5-7pm** at Bakar Labs, in the courtyard! \n\nWe've invited you, members of the East Bay biotech community, and our friends at Activate, the coolest deep tech program around. Come for the libations, stay for the conversation. \n\nRSVP** **[**here**](https://airtable.com/shrvTl0Wtub7xxn8W)** **so that we can get a headcount on food and drinks. Hope you can join us!\n\nAnd.... if you can't remember what day it is, may the fourth be with you. Light sabers and Jedi mind tricks welcome!!"","user":{"id":323931,"full_name":"Uri Lopatin","avatar_thumb":"https://bookface-images.s3.amazonaws.com/avatars/5778aaf0271d7d376bc1f3f639c7a6d72753d456.jpg","companies":[{"id":22111,"name":"Pardes Biosciences","batch":"S20","url":"/company/22111","former_company":false,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/7a90b132bd3ef57761690e68c3355e7471e2abf7.png"},{"id":64,"name":"Y Combinator","batch":"","url":"/company/64","former_company":true,"logo_url":"https://bookface-images.s3.amazonaws.com/small_logos/2db694dd7905db37d037821a2fdaf9fa0708a964.png"}],"email":"uri@ycombinator.com","url":"/user/323931","badges":["yc_staff"],"trusted_answerer":false},"comment_count":0,"views_count":64,"state":"","channel":"classifieds","url":"https://bookface.ycombinator.com/posts/71257","edit_url":"https://bookface.ycombinator.com/posts/71257","important":false,"created_at":"2023-04-28T15:54:46.981Z","pinned":false,"slug":"IXJ-bakar-labs-hosting-a-happy-hour-on-may-4th-5-7pm","all_tags":["Social","Social Networking","happy hour","east bay","happy hours"]}],"companyNews":[{"id":3216,"title":"Replit, the web-based IDE developing a GitHub Copilot competitor, raises $100M | TechCrunch","url":"https://techcrunch.com/2023/04/27/replit-funding-100m-generative-ai/","image_url":"https://techcrunch.com/wp-content/uploads/2023/04/GettyImages-1322437940-e1680174106448.jpg?resize=1200,675","posted_at":"2023-04-27T19:00:00.000Z","created_at":"2023-04-27T19:37:21.881Z","updated_at":"2023-04-28T13:25:58.941Z","domain":"techcrunch.com"},{"id":3217,"title":"Y Combinator-backed Luca aims to optimize retail prices at enterprise scale | TechCrunch","url":"https://techcrunch.com/2023/04/27/luca-raises-cash-for-pricing-optimization/","image_url":"https://techcrunch.com/wp-content/uploads/2022/07/GettyImages-1387537769.jpg?resize=1200,800","posted_at":"2023-04-27T19:00:00.000Z","created_at":"2023-04-27T19:38:40.258Z","updated_at":"2023-04-28T13:25:58.943Z","domain":"techcrunch.com"},{"id":3218,"title":"Jopwell Acquired by True | Fast Company","url":"https://www.fastcompany.com/90886934/jopwell-acquired-by-true-the-top-five-things-ive-learned-from-being-a-black-founder","image_url":"","posted_at":"2023-04-27T19:00:00.000Z","created_at":"2023-04-27T20:24:44.089Z","updated_at":"2023-04-28T13:25:58.944Z","domain":"www.fastcompany.com"}],"hnPosts":[{"id":35720865,"author_name":"NN88","title":"Automakers are starting to admit that drivers hate touchscreens","url":"https://slate.com/business/2023/04/cars-buttons-touchscreens-vw-porsche-nissan-hyundai.html","score":1272,"created_at":1682548186,"featured_at":1682688520},{"id":35727967,"author_name":"xmlblog","title":"Datomic is Free","url":"https://blog.datomic.com/2023/04/datomic-is-free.html","score":1017,"created_at":1682602847,"featured_at":1682688520},{"id":35730711,"author_name":"twapi","title":"Every web search result in Brave Search is now served by our own index","url":"https://brave.com/search-independence/","score":620,"created_at":1682613475,"featured_at":1682688520},{"id":35724634,"author_name":"andsoitis","title":"Steven Spielberg: 'No film should be revised' based on modern sensitivity","url":"https://www.theguardian.com/film/2023/apr/26/steven-spielberg-et-guns-movie-edit","score":861,"created_at":1682581868,"featured_at":1682688520}],"youtubes":[{"id":"EiRnSjcVIqk","featured_at":1682688304}],"syllabusUrl":"/knowledge/C4-batch-syllabus","postBatchAdviceUrl":"/knowledge/BA-post-batch-advice","waasAdPlacement":{"imgUrl":"https://i.imgur.com/vt8n9Ik.png","targetUrl":"/posts/71251"},"batchStart":"2023-01-08"}</script>
		
  </div></div><div id="BottomMobileNavbar-react-component-9f975abe-af77-45aa-9e40-992807cef14f"></div>
		<script type="application/json" class="js-react-on-rails-component" data-component-name="BottomMobileNavbar" data-dom-id="BottomMobileNavbar-react-component-9f975abe-af77-45aa-9e40-992807cef14f">{"navMenus":{"left":[{"name":"Community","icon":"ion-md-people","badge_content":null,"entries":[{"name":"Forum","icon":"ion-md-chatboxes","path":"/channels/all"},{"name":"Company Directory","icon":"ion-md-briefcase","path":"/directory"},{"name":"Founder Directory","icon":"ion-md-contacts","path":"/directory/founders"},{"name":"Founder Navigator (Beta)","icon":"ion-md-compass","path":"/navigator"},{"name":"Batch W2021","icon":"ion-ios-people","path":"/batches/w2021"},{"name":"Group 3","icon":"ion-ios-return-right","path":"/batches/w2021#group-3"},{"name":"Alumni Demo Day","icon":"ion-md-bonfire","path":"/directory/demo_day"},{"name":"Launch YC","icon":"ion-ios-megaphone","path":"https://www.ycombinator.com/launches"},{"name":"YC Top Companies","icon":"ion-ios-trending-up-outline","path":"https://www.ycombinator.com/topcompanies"},{"name":"Non-YC Companies","icon":"ion-ios-globe","path":"/directory/non_yc_directory"},{"name":"YC Store","icon":"ion-ios-shirt","path":"https://shop.gemnote.com/yc/shop"},{"name":"Alumni Groups","icon":"ion-ios-chatbubbles-outline","path":"/knowledge/9m-online-alumni-groups"},{"name":"This week at YC","icon":"ion-ios-information-circle-outline","path":"https://us7.campaign-archive.com/home/?u=6507bf4e4c2df3fdbae6ef738\u0026id=547725049b"}]},{"name":"Resources","icon":"ion-ios-book","entries":[{"name":"User Manual","icon":"ion-ios-bookmarks-outline","path":"/knowledge/1T-yc-user-manual"},{"name":"Batch Schedule","icon":"ion-md-calendar","path":"/schedule"},{"name":"Deals","icon":"ion-md-card","path":"/deals"},{"name":"Professional Services Directory","icon":"ion-md-people","path":"/professional_services"},{"name":"Fundraising Trends","icon":"ion-ios-stats","path":"/trends"},{"name":"Investor Database","icon":"ion-logo-usd","path":"/directory/investors?year=%5B2019%2C+2023%5D"},{"name":"Startup Library","icon":"ion-ios-book-outline","path":"https://ycombinator.com/library"},{"name":"Series A Manual","icon":"ion-ios-compass","path":"/knowledge/FI-series-a-manual"},{"name":"Admissions","icon":"ion-ios-school","path":"/knowledge/Go-yc-admissions"},{"name":"Knowledge Base","icon":"ion-md-globe","path":"/knowledge"},{"name":"Bookface Companion","icon":"ion-logo-chrome","path":"/knowledge/Em-bookface-companion"},{"name":"My Lists","icon":"ion-ios-list-box-outline","path":"/lists"}]},{"name":"Contact YC","icon":"ion-logo-hackernews","entries":[{"name":"Book Office Hours","icon":"ion-md-bookmarks","path":"/booker"},{"name":"Financings \u0026 Transactions","icon":"ion-md-cash","path":"/knowledge/Bp-notify-yc-financings-transactions"},{"name":"People at YC","icon":"ion-md-people","path":"/yc"},{"name":"Report Bad Actors","icon":"ion-md-sad","path":"https://docs.google.com/forms/d/e/1FAIpQLSf1BT_28VFKQS-AQm9XKA238-o2WBT90Um3PnD0xSg5UBx-XQ/viewform"},{"name":"Recommend Startups","icon":"ion-md-person-add","path":"https://apply.ycombinator.com/recommendations"},{"name":"Email Us","icon":"ion-ios-mail","path":"mailto:software@ycombinator.com"},{"name":"Privacy Policy","icon":"ion-ios-information-circle","path":"https://www.ycombinator.com/legal#privacy"}]},{"name":"Recruiting","icon":"ion-md-person-add","entries":[{"name":"Dashboard","icon":"ion-ios-home","path":"/workatastartup/dashboard"},{"name":"Source","icon":"ion-ios-contacts","path":"/workatastartup/applicants"},{"name":"Inbox","icon":"ion-ios-mail","path":"/workatastartup/inbox","waas_unread_inbox":true},{"name":"Applicants","icon":"ion-ios-hand","path":"/workatastartup/applied","waas_unread_applied":true},{"name":"Jobs","icon":"ion-md-document","path":"/company/23105/jobs","badge_content":null}],"waas_unread_inbox":true},{"name":"Company","icon":"ion-md-briefcase","entries":[{"name":"Questbook","icon":"ion-md-briefcase","path":"/company/23105"},{"name":"Investments","icon":"ion-ios-return-right","path":"/company/23105/investments"},{"name":"Demo Day Leads","icon":"ion-ios-return-right","path":"/company/23105/demo_day_investors"},{"name":"Rate your investors","icon":"ion-ios-return-right","path":"/investor_grades"},{"name":"Company Updates","icon":"ion-ios-return-right","path":"/companies/23155/company_updates"}]}],"right":[{"name":"qwe","icon":"ion-md-contact","type":"user","entries":[{"name":"My Profile","icon":"ion-md-contact","path":"/user/182853"},{"name":"Forum Notifications","icon":"ion-md-notifications","path":"/forum/notifications"},{"name":"Forum Keyword Alerts","icon":"ion-md-headset","path":"/forum_alerts"},{"name":"Log Out","icon":"ion-md-log-out","path":"/session/logout"}]}]},"subnav":null,"currentUser":{"avatarThumbUrl":"https://bookface-images.s3.amazonaws.com/avatars/a5c05c087cf0b25cf0e08654e2d95128e379b7ec.jpg"},"currentPath":"/home","loggedIn":true,"inWaas":false,"releaseNotes":{"notes":[],"type":"bookface","since":null}}</script>
		
  <!-- Segment --><script>!function(){var analytics=window.analytics=window.analytics||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","once","off","on"];analytics.factory=function(t){return function(){var e=Array.prototype.slice.call(arguments);e.unshift(t);analytics.push(e);return analytics}};for(var t=0;t<analytics.methods.length;t++){var e=analytics.methods[t];analytics[e]=analytics.factory(e)}analytics.load=function(t,e){var n=document.createElement("script");n.type="text/javascript";n.async=!0;n.src="https://segment-cdn.ycombinator.com/seg-proxy/"+t+"/seg.js";var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(n,a);analytics._loadOptions=e};analytics.SNIPPET_VERSION="4.1.0";
  analytics.load("OU4fgsPeMupJ2LesI1K7dfOsH7JjCmJD");
  analytics.page();
  }}();</script><script>document.addEventListener("DOMContentLoaded", function(e) {
	analytics.ready(function() {
	  var traits = {
		first_name: 'qwerqwer',
		last_name: 'qwer',
		created_at: '2017-03-07 08:20:26 UTC',
		email: 'qwer@cqwerqwer,
		hnid: 'qwer',
		company: 'Questbook',
		batch: 'w2021',
		batches: 'w2021',
		is_yc: 'true',
		is_core: 'true',
		is_fellowship: 'false',
		is_active_founder: 'true',
		is_investor: 'false',
		is_media: 'false',
		in_current_batch: 'false',
	  };
  
	  analytics.identify('182853', traits);
	  analytics.user().traits(traits);
	});
  });</script><!-- End Segment --><!-- Google Analytics -->
  <script>
  (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
  (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
  m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
  })(window,document,'script','//www.google-analytics.com/analytics.js','ga');
  
  ga('create', 'UA-66452210-1', 'auto', {'legacyCookieDomain': 'bookface.ycombinator.com'});
  ga('set', 'userId', 182853); // Set the user ID using signed-in user_id.
  ga('set', 'dimension1', false);
  ga('set', 'dimension2', 'w2021');
  ga('set', 'dimension3', true);
  ga('set', 'dimension4', true);
  ga('send', 'pageview');
  
  </script>
  <!-- End Google Analytics -->
  </body></html>
`

const chunkedResp = Buffer.from(`SFRUUC8xLjEgMjAwIE9LDQpEYXRlOiBNb24sIDA0IFNlcCAyMDIzIDE1OjQ0OjMzIEdNVA0KQ29u
dGVudC1UeXBlOiB0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLTgNClRyYW5zZmVyLUVuY29kaW5nOiBj
aHVua2VkDQpDb25uZWN0aW9uOiBjbG9zZQ0KQ2FjaGUtQ29udHJvbDogbWF4LWFnZT0wLCBwcml2
YXRlLCBtdXN0LXJldmFsaWRhdGUNCkVUYWc6IFcvImI4NjA4ZTM5MTk0ZTZhMTk2ZGViMjZlZDRh
Mjg3OTk2Ig0KTGluazogPC9hc3NldHMvYXBwbGljYXRpb24tY2VlODVkZTY5NzkyNjQ2OTBiNmQx
ZWU0YjIzZmY0YmQ3OWJjNDllODlkOWU0YTI0YTFhYTg0MDczMDlmMjU3NS5jc3M+OyByZWw9cHJl
bG9hZDsgYXM9c3R5bGU7IG5vcHVzaCw8L3BhY2tzL2Nzcy8yNzg0LTY5ZDQ0Yjg1LmNzcz47IHJl
bD1wcmVsb2FkOyBhcz1zdHlsZTsgbm9wdXNoLDwvcGFja3MvY3NzLzQxMDQtN2Q1ZjMyMzEuY3Nz
PjsgcmVsPXByZWxvYWQ7IGFzPXN0eWxlOyBub3B1c2gsPC9wYWNrcy9jc3MvODU2NC02NjA2YTA2
Yy5jc3M+OyByZWw9cHJlbG9hZDsgYXM9c3R5bGU7IG5vcHVzaCw8L3BhY2tzL2Nzcy8zMDM0LWE1
YTFhOTNiLmNzcz47IHJlbD1wcmVsb2FkOyBhcz1zdHlsZTsgbm9wdXNoLDwvcGFja3MvY3NzLzE1
MjktNjUzY2M0MDcuY3NzPjsgcmVsPXByZWxvYWQ7IGFzPXN0eWxlOyBub3B1c2gsPC9wYWNrcy9j
c3MvNDQ2Mi00ZjA4MWEzZC5jc3M+OyByZWw9cHJlbG9hZDsgYXM9c3R5bGU7IG5vcHVzaCw8L3Bh
Y2tzL2Nzcy8zNTM0LTA2N2I3N2Q1LmNzcz47IHJlbD1wcmVsb2FkOyBhcz1zdHlsZTsgbm9wdXNo
LDwvcGFja3MvY3NzL2FwcGxpY2F0aW9uLWJjOGU2NWIwLmNzcz47IHJlbD1wcmVsb2FkOyBhcz1z
dHlsZTsgbm9wdXNoLDwvcGFja3MvY3NzLzE1MjktNjUzY2M0MDcuY3NzPjsgcmVsPXByZWxvYWQ7
IGFzPXN0eWxlOyBub3B1c2gsPC9wYWNrcy9jc3MvdGFpbHdpbmQtYzg1NzM0NDYuY3NzPjsgcmVs
PXByZWxvYWQ7IGFzPXN0eWxlOyBub3B1c2gsPC9wYWNrcy9qcy9ydW50aW1lLWM1ZDJiMmI4MzU5
ZWViNzUzMTExLmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFja3MvanMv
MTc2MS02ODlhM2I5ZmQxZDdmNjFhNjYwMi5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5v
cHVzaCw8L3BhY2tzL2pzLzY4NDktMmM3YzljNWM3ODIwOWNhODUwNmIuanM+OyByZWw9cHJlbG9h
ZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy84NDYxLTdjMDQyZmM3ZDMwYjk4Yzc4MGEx
LmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFja3MvanMvOTk2NS1lODNl
ZTlhYzYwOWE2NmNmMWI0Ny5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3Bh
Y2tzL2pzLzUxOTYtMGQyYWU5NjI0MzQ2OGFlZGFhMzMuanM+OyByZWw9cHJlbG9hZDsgYXM9c2Ny
aXB0OyBub3B1c2gsPC9wYWNrcy9qcy80Mjc1LTlmMTZkN2QyMWY4NDc4MDNkMWZmLmpzPjsgcmVs
PXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFja3MvanMvOTkwNy1iNWZjMTQ1OGQ1ZjYx
OWU0YWY5Ny5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzc3
OTItMGNlZmM4NmFkYThlMjZjODc3MTQuanM+OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1
c2gsPC9wYWNrcy9qcy8yMTg3LTZlODczZDZhODBkODIyZGQ4N2U4LmpzPjsgcmVsPXByZWxvYWQ7
IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFja3MvanMvOTUwNC0zZjZjMGEzOWNiYzI1NTllMjFiNy5q
cz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzMyNjEtZGEyZTgz
Mjg1MTgyODY5YWFjNzkuanM+OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNr
cy9qcy8zNTQwLTBiMThhNmZjNzZlOTI5N2ZjN2ExLmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlw
dDsgbm9wdXNoLDwvcGFja3MvanMvNzQ5NC0xMmQwMTU0YzgxYjkzMzAzNmExNi5qcz47IHJlbD1w
cmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzUyNzYtNTYyZTk1M2FlOGYzNjZh
ZGRkZDcuanM+OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy8xMzQ5
LThkZGE4ZTQ3YWJjYzhlNjcxMmI5LmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNo
LDwvcGFja3MvanMvMTM4My0zZTJlODk4ZmE4MDBhN2MyMWEzMC5qcz47IHJlbD1wcmVsb2FkOyBh
cz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzk4NzMtYzZjODhjNDM5MGZlMDg5YWM1ZDQuanM+
OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy8yNzg0LTg3MGYxYzcw
MWI0ZGUzOTIyOTg0LmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFja3Mv
anMvNTY0My1hMjY5NjJhN2ZhZmVjOTQ4MjA1Zi5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7
IG5vcHVzaCw8L3BhY2tzL2pzLzUyNS1jYzJmZTUxNWQ1OTZmNTg4MDU2Yi5qcz47IHJlbD1wcmVs
b2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzQ4MDctN2FmOTc0YzdhNmZlOTJkZTk1
MDIuanM+OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy80MTA0LWJh
M2I3ZmQ5MzYyMjRiYTlhM2UxLmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwv
cGFja3MvanMvMzE4LWQ0Y2M4ZjYxOGU0MDc3NGQyZmZjLmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNj
cmlwdDsgbm9wdXNoLDwvcGFja3MvanMvNDI2NC1hMjI0OTk0ZjZmZjQzZTVhMTI0NC5qcz47IHJl
bD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzg1NjQtNjE4NDIzMWU2ZmE5
ODZkNTk0YWUuanM+OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy8y
MTAyLTkwZTUwZTg3ZDUxZWI2NTA0MDQ1LmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9w
dXNoLDwvcGFja3MvanMvMzE5NC01NTIzYzg0MTMyNzZiMjBjODVhYi5qcz47IHJlbD1wcmVsb2Fk
OyBhcz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzEwNzUtYzg2YzQ5YjAwNmRiNWE3MWYzZGIu
anM+OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy8xNzczLWEwZThh
NzIxMGY1M2U0ZmQ2YzU2LmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFj
a3MvanMvNzU3NS0zYjM0OThmNjU5ZjQxNWZlODhmYy5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3Jp
cHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzMwMzQtMjk4ZDQzMWRhNjU0ZmI2OGJkMzIuanM+OyByZWw9
cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy84OTUyLWVhMGY2Y2ZmYzU0ZDZj
M2ZmZTE2LmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsgbm9wdXNoLDwvcGFja3MvanMvNDQ2
Mi05NzNmZjAwOTVhN2MxNGIwNjk3YS5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVz
aCw8L3BhY2tzL2pzLzI5OC05MWZjOTZiNDQ4MDlkNzBhOWUwNy5qcz47IHJlbD1wcmVsb2FkOyBh
cz1zY3JpcHQ7IG5vcHVzaCw8L3BhY2tzL2pzLzM1MzQtMDgyZTYzYmE4ZjBmYjZmM2YyNTQuanM+
OyByZWw9cHJlbG9hZDsgYXM9c2NyaXB0OyBub3B1c2gsPC9wYWNrcy9qcy9hcHBsaWNhdGlvbi1i
NTM1NGY2MWFiYzlmMTQ1YTIxOC5qcz47IHJlbD1wcmVsb2FkOyBhcz1zY3JpcHQ7IG5vcHVzaCw8
L2Fzc2V0cy9hcHBsaWNhdGlvbi0yY2Q0ZWQ0ODc3OTEzMTgxOWIxZGU3NTBjODExZjJiMzE0ODJl
YzFhMDg4ZTA0ZDUyNTlkYzAwNWQzNjU4MmNkLmpzPjsgcmVsPXByZWxvYWQ7IGFzPXNjcmlwdDsg
bm9wdXNoDQpSZWZlcnJlci1Qb2xpY3k6IHN0cmljdC1vcmlnaW4td2hlbi1jcm9zcy1vcmlnaW4N
ClNldC1Db29raWU6ICoqKg0KU3RhdHVzOiAyMDAgT0sNClN0cmljdC1UcmFuc3BvcnQtU2VjdXJp
dHk6IG1heC1hZ2U9NjMwNzIwMDA7IGluY2x1ZGVTdWJEb21haW5zDQpWYXJ5OiBBY2NlcHQsQWNj
ZXB0LUVuY29kaW5nDQpYLUNvbnRlbnQtVHlwZS1PcHRpb25zOiBub3NuaWZmDQpYLURvd25sb2Fk
LU9wdGlvbnM6IG5vb3Blbg0KWC1GcmFtZS1PcHRpb25zOiBTQU1FT1JJR0lODQpYLVBlcm1pdHRl
ZC1Dcm9zcy1Eb21haW4tUG9saWNpZXM6IG5vbmUNClgtUmVxdWVzdC1JZDogY2NhYWQ1YzAyYWNl
Njk2YzBkMmU5MDhjZmU3YmUyMmMNClgtWFNTLVByb3RlY3Rpb246IDE7IG1vZGU9YmxvY2sNCkNG
LUNhY2hlLVN0YXR1czogRFlOQU1JQw0KU2VydmVyOiBjbG91ZGZsYXJlDQpDRi1SQVk6IDgwMTc1
YWJiNmI1MDAyNTEtQ0RHDQoNCjc5YWYNCjwhRE9DVFlQRSBodG1sPjxodG1sIGNsYXNzPSJob21l
IGluZGV4IGZvcnVtLXBhZ2UgaC1mdWxsIGJnLWJlaWdlLWxpZ2h0Ij48aGVhZD48dGl0bGU+Qm9v
a2ZhY2U8L3RpdGxlPjxzY3JpcHQ+d2luZG93LlJBSUxTX0VOViA9ICdwcm9kdWN0aW9uJzs8L3Nj
cmlwdD48c2NyaXB0PnZhciBfcm9sbGJhckNvbmZpZyA9IHsKICBhY2Nlc3NUb2tlbjogIjFhYTIy
YTAxYmZmZTRjMDdiNzBhZGNlZGI2M2VkNzZkIiwKICBjYXB0dXJlVW5jYXVnaHQ6IHRydWUsCiAg
Y2FwdHVyZVVuaGFuZGxlZFJlamVjdGlvbnM6IHRydWUsCiAgaG9zdFNhZmVMaXN0OiBbJ3ljb21i
aW5hdG9yLmNvbScsICd3b3JrYXRhc3RhcnR1cC5jb20nXSwKICBwYXlsb2FkOiB7CiAgICAgIGNs
aWVudDogewogICAgICAgICAgamF2YXNjcmlwdDogewogICAgICAgICAgICAgIHNvdXJjZV9tYXBf
ZW5hYmxlZDogdHJ1ZSwKICAgICAgICAgICAgICBjb2RlX3ZlcnNpb246ICIxODczZDU4NGMyMmIw
MjNkZDYwZDFjNjY1ZTIxYzcwN2VmMTllNWIwIHJ1YnkgMy4yLjIgKDIwMjMtMDMtMzAgcmV2aXNp
b24gZTUxMDE0ZjljMCkgK1lKSVQgW3g4Nl82NC1saW51eF0iLAogICAgICAgICAgICAgIGd1ZXNz
X3VuY2F1Z2h0X2ZyYW1lczogdHJ1ZQogICAgICAgICAgfQogICAgICB9LAogICAgICBlbnZpcm9u
bWVudDogJ2Jyb3dzZXItcHJvZHVjdGlvbicsCiAgICAgIHBlcnNvbjogewogICAgICAgIGlkOiAi
MTgyODUzIiwKICAgICAgICB1c2VybmFtZTogIm1hZGhhdmFubWFsb2xhbiIKICAgICAgfQogIH0s
CiAgdHJhbnNmb3JtOiBmdW5jdGlvbihwYXlsb2FkKSB7CiAgICB2YXIgdHJhY2UgPSBwYXlsb2Fk
LmJvZHkudHJhY2U7CiAgICB2YXIgbG9jUmVnZXggPSAvXihodHRwcz8pOlwvXC9bXlwvXStcLygu
KikvOwogICAgaWYgKHRyYWNlICYmIHRyYWNlLmZyYW1lcykgewogICAgICBmb3IgKHZhciBpID0g
MDsgaSA8IHRyYWNlLmZyYW1lcy5sZW5ndGg7IGkrKykgewogICAgICAgIHZhciBmaWxlbmFtZSA9
IHRyYWNlLmZyYW1lc1tpXS5maWxlbmFtZTsKICAgICAgICBpZiAoZmlsZW5hbWUpIHsKICAgICAg
ICAgIHZhciBtID0gZmlsZW5hbWUubWF0Y2gobG9jUmVnZXgpOwogICAgICAgICAgaWYgKG0pIHsK
ICAgICAgICAgICAgdHJhY2UuZnJhbWVzW2ldLmZpbGVuYW1lID0gbVsxXSArICc6Ly9keW5hbWlj
aG9zdC8nICsgbVsyXTsKICAgICAgICAgIH0KICAgICAgICB9CiAgICAgIH0KICAgIH0KICB9Cn07
CgovLyBSb2xsYmFyIFNuaXBwZXQKIWZ1bmN0aW9uKHIpe3ZhciBlPXt9O2Z1bmN0aW9uIG8obil7
aWYoZVtuXSlyZXR1cm4gZVtuXS5leHBvcnRzO3ZhciB0PWVbbl09e2k6bixsOiExLGV4cG9ydHM6
e319O3JldHVybiByW25dLmNhbGwodC5leHBvcnRzLHQsdC5leHBvcnRzLG8pLHQubD0hMCx0LmV4
cG9ydHN9by5tPXIsby5jPWUsby5kPWZ1bmN0aW9uKHIsZSxuKXtvLm8ocixlKXx8T2JqZWN0LmRl
ZmluZVByb3BlcnR5KHIsZSx7ZW51bWVyYWJsZTohMCxnZXQ6bn0pfSxvLnI9ZnVuY3Rpb24ocil7
InVuZGVmaW5lZCIhPXR5cGVvZiBTeW1ib2wmJlN5bWJvbC50b1N0cmluZ1RhZyYmT2JqZWN0LmRl
ZmluZVByb3BlcnR5KHIsU3ltYm9sLnRvU3RyaW5nVGFnLHt2YWx1ZToiTW9kdWxlIn0pLE9iamVj
dC5kZWZpbmVQcm9wZXJ0eShyLCJfX2VzTW9kdWxlIix7dmFsdWU6ITB9KX0sby50PWZ1bmN0aW9u
KHIsZSl7aWYoMSZlJiYocj1vKHIpKSw4JmUpcmV0dXJuIHI7aWYoNCZlJiYib2JqZWN0Ij09dHlw
ZW9mIHImJnImJnIuX19lc01vZHVsZSlyZXR1cm4gcjt2YXIgbj1PYmplY3QuY3JlYXRlKG51bGwp
O2lmKG8ucihuKSxPYmplY3QuZGVmaW5lUHJvcGVydHkobiwiZGVmYXVsdCIse2VudW1lcmFibGU6
ITAsdmFsdWU6cn0pLDImZSYmInN0cmluZyIhPXR5cGVvZiByKWZvcih2YXIgdCBpbiByKW8uZChu
LHQsZnVuY3Rpb24oZSl7cmV0dXJuIHJbZV19LmJpbmQobnVsbCx0KSk7cmV0dXJuIG59LG8ubj1m
dW5jdGlvbihyKXt2YXIgZT1yJiZyLl9fZXNNb2R1bGU/ZnVuY3Rpb24oKXtyZXR1cm4gci5kZWZh
dWx0fTpmdW5jdGlvbigpe3JldHVybiByfTtyZXR1cm4gby5kKGUsImEiLGUpLGV9LG8ubz1mdW5j
dGlvbihyLGUpe3JldHVybiBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocixl
KX0sby5wPSIiLG8oby5zPTApfShbZnVuY3Rpb24ocixlLG8peyJ1c2Ugc3RyaWN0Ijt2YXIgbj1v
KDEpLHQ9byg1KTtfcm9sbGJhckNvbmZpZz1fcm9sbGJhckNvbmZpZ3x8e30sX3JvbGxiYXJDb25m
aWcucm9sbGJhckpzVXJsPV9yb2xsYmFyQ29uZmlnLnJvbGxiYXJKc1VybHx8Imh0dHBzOi8vY2Ru
LnJvbGxiYXIuY29tL3JvbGxiYXJqcy9yZWZzL3RhZ3MvdjIuMTkuMC9yb2xsYmFyLm1pbi5qcyIs
X3JvbGxiYXJDb25maWcuYXN5bmM9dm9pZCAwPT09X3JvbGxiYXJDb25maWcuYXN5bmN8fF9yb2xs
YmFyQ29uZmlnLmFzeW5jO3ZhciBhPW4uc2V0dXBTaGltKHdpbmRvdyxfcm9sbGJhckNvbmZpZyks
bD10KF9yb2xsYmFyQ29uZmlnKTt3aW5kb3cucm9sbGJhcj1uLlJvbGxiYXIsYS5sb2FkRnVsbCh3
aW5kb3csZG9jdW1lbnQsIV9yb2xsYmFyQ29uZmlnLmFzeW5jLF9yb2xsYmFyQ29uZmlnLGwpfSxm
dW5jdGlvbihyLGUsbyl7InVzZSBzdHJpY3QiO3ZhciBuPW8oMiksdD1vKDMpO2Z1bmN0aW9uIGEo
cil7cmV0dXJuIGZ1bmN0aW9uKCl7dHJ5e3JldHVybiByLmFwcGx5KHRoaXMsYXJndW1lbnRzKX1j
YXRjaChyKXt0cnl7Y29uc29sZS5lcnJvcigiW1JvbGxiYXJdOiBJbnRlcm5hbCBlcnJvciIscil9
Y2F0Y2gocil7fX19fXZhciBsPTA7ZnVuY3Rpb24gaShyLGUpe3RoaXMub3B0aW9ucz1yLHRoaXMu
X3JvbGxiYXJPbGRPbkVycm9yPW51bGw7dmFyIG89bCsrO3RoaXMuc2hpbUlkPWZ1bmN0aW9uKCl7
cmV0dXJuIG99LCJ1bmRlZmluZWQiIT10eXBlb2Ygd2luZG93JiZ3aW5kb3cuX3JvbGxiYXJTaGlt
cyYmKHdpbmRvdy5fcm9sbGJhclNoaW1zW29dPXtoYW5kbGVyOmUsbWVzc2FnZXM6W119KX12YXIg
cz1vKDQpLGQ9ZnVuY3Rpb24ocixlKXtyZXR1cm4gbmV3IGkocixlKX0sYz1mdW5jdGlvbihyKXty
ZXR1cm4gbmV3IHMoZCxyKX07ZnVuY3Rpb24gdShyKXtyZXR1cm4gYSgoZnVuY3Rpb24oKXt2YXIg
ZT10aGlzLG89QXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLDApLG49e3NoaW06
ZSxtZXRob2Q6cixhcmdzOm8sdHM6bmV3IERhdGV9O3dpbmRvdy5fcm9sbGJhclNoaW1zW3RoaXMu
c2hpbUlkKCldLm1lc3NhZ2VzLnB1c2gobil9KSl9aS5wcm90b3R5cGUubG9hZEZ1bGw9ZnVuY3Rp
b24ocixlLG8sbix0KXt2YXIgbD0hMSxpPWUuY3JlYXRlRWxlbWVudCgic2NyaXB0Iikscz1lLmdl
dEVsZW1lbnRzQnlUYWdOYW1lKCJzY3JpcHQiKVswXSxkPXMucGFyZW50Tm9kZTtpLmNyb3NzT3Jp
Z2luPSIiLGkuc3JjPW4ucm9sbGJhckpzVXJsLG98fChpLmFzeW5jPSEwKSxpLm9ubG9hZD1pLm9u
cmVhZHlzdGF0ZWNoYW5nZT1hKChmdW5jdGlvbigpe2lmKCEobHx8dGhpcy5yZWFkeVN0YXRlJiYi
bG9hZGVkIiE9PXRoaXMucmVhZHlTdGF0ZSYmImNvbXBsZXRlIiE9PXRoaXMucmVhZHlTdGF0ZSkp
e2kub25sb2FkPWkub25yZWFkeXN0YXRlY2hhbmdlPW51bGw7dHJ5e2QucmVtb3ZlQ2hpbGQoaSl9
Y2F0Y2gocil7fWw9ITAsZnVuY3Rpb24oKXt2YXIgZTtpZih2b2lkIDA9PT1yLl9yb2xsYmFyRGlk
TG9hZCl7ZT1uZXcgRXJyb3IoInJvbGxiYXIuanMgZGlkIG5vdCBsb2FkIik7Zm9yKHZhciBvLG4s
YSxsLGk9MDtvPXIuX3JvbGxiYXJTaGltc1tpKytdOylmb3Iobz1vLm1lc3NhZ2VzfHxbXTtuPW8u
c2hpZnQoKTspZm9yKGE9bi5hcmdzfHxbXSxpPTA7aTxhLmxlbmd0aDsrK2kpaWYoImZ1bmN0aW9u
Ij09dHlwZW9mKGw9YVtpXSkpe2woZSk7YnJlYWt9fSJmdW5jdGlvbiI9PXR5cGVvZiB0JiZ0KGUp
fSgpfX0pKSxkLmluc2VydEJlZm9yZShpLHMpfSxpLnByb3RvdHlwZS53cmFwPWZ1bmN0aW9uKHIs
ZSxvKXt0cnl7dmFyIG47aWYobj0iZnVuY3Rpb24iPT10eXBlb2YgZT9lOmZ1bmN0aW9uKCl7cmV0
dXJuIGV8fHt9fSwiZnVuY3Rpb24iIT10eXBlb2YgcilyZXR1cm4gcjtpZihyLl9pc1dyYXApcmV0
dXJuIHI7aWYoIXIuX3JvbGxiYXJfd3JhcHBlZCYmKHIuX3JvbGxiYXJfd3JhcHBlZD1mdW5jdGlv
bigpe28mJiJmdW5jdGlvbiI9PXR5cGVvZiBvJiZvLmFwcGx5KHRoaXMsYXJndW1lbnRzKTt0cnl7
cmV0dXJuIHIuYXBwbHkodGhpcyxhcmd1bWVudHMpfWNhdGNoKG8pe3ZhciBlPW87dGhyb3cgZSYm
KCJzdHJpbmciPT10eXBlb2YgZSYmKGU9bmV3IFN0cmluZyhlKSksZS5fcm9sbGJhckNvbnRleHQ9
bigpfHx7fSxlLl9yb2xsYmFyQ29udGV4dC5fd3JhcHBlZFNvdXJjZT1yLnRvU3RyaW5nKCksd2lu
ZG93Ll9yb2xsYmFyV3JhcHBlZEVycm9yPWUpLGV9fSxyLl9yb2xsYmFyX3dyYXBwZWQuX2lzV3Jh
cD0hMCxyLmhhc093blByb3BlcnR5KSlmb3IodmFyIHQgaW4gcilyLmhhc093blByb3BlcnR5KHQp
JiYoci5fcm9sbGJhcl93cmFwcGVkW3RdPXJbdF0pO3JldHVybiByLl9yb2xsYmFyX3dyYXBwZWR9
Y2F0Y2goZSl7cmV0dXJuIHJ9fTtmb3IodmFyIHA9ImxvZyxkZWJ1ZyxpbmZvLHdhcm4sd2Fybmlu
ZyxlcnJvcixjcml0aWNhbCxnbG9iYWwsY29uZmlndXJlLGhhbmRsZVVuY2F1Z2h0RXhjZXB0aW9u
LGhhbmRsZUFub255bW91c0Vycm9ycyxoYW5kbGVVbmhhbmRsZWRSZWplY3Rpb24sY2FwdHVyZUV2
ZW50LGNhcHR1cmVEb21Db250ZW50TG9hZGVkLGNhcHR1cmVMb2FkIi5zcGxpdCgiLCIpLGY9MDtm
PHAubGVuZ3RoOysrZilpLnByb3RvdHlwZVtwW2ZdXT11KHBbZl0pO3IuZXhwb3J0cz17c2V0dXBT
aGltOmZ1bmN0aW9uKHIsZSl7aWYocil7dmFyIG89ZS5nbG9iYWxBbGlhc3x8IlJvbGxiYXIiO2lm
KCJvYmplY3QiPT10eXBlb2YgcltvXSlyZXR1cm4gcltvXTtyLl9yb2xsYmFyU2hpbXM9e30sci5f
cm9sbGJhcldyYXBwZWRFcnJvcj1udWxsO3ZhciBsPW5ldyBjKGUpO3JldHVybiBhKChmdW5jdGlv
bigpe2UuY2FwdHVyZVVuY2F1Z2h0JiYobC5fcm9sbGJhck9sZE9uRXJyb3I9ci5vbmVycm9yLG4u
Y2FwdHVyZVVuY2F1Z2h0RXhjZXB0aW9ucyhyLGwsITApLGUud3JhcEdsb2JhbEV2ZW50SGFuZGxl
cnMmJnQocixsLCEwKSksZS5jYXB0dXJlVW5oYW5kbGVkUmVqZWN0aW9ucyYmbi5jYXB0dXJlVW5o
YW5kbGVkUmVqZWN0aW9ucyhyLGwsITApO3ZhciBhPWUuYXV0b0luc3RydW1lbnQ7cmV0dXJuITEh
PT1lLmVuYWJsZWQmJih2b2lkIDA9PT1hfHwhMD09PWF8fCJvYmplY3QiPT10eXBlb2YgYSYmYS5u
ZXR3b3JrKSYmci5hZGRFdmVudExpc3RlbmVyJiYoci5hZGRFdmVudExpc3RlbmVyKCJsb2FkIixs
LmNhcHR1cmVMb2FkLmJpbmQobCkpLHIuYWRkRXZlbnRMaXN0ZW5lcigiRE9NQ29udGVudExvYWRl
ZCIsbC5jYXB0dXJlRG9tQ29udGVudExvYWRlZC5iaW5kKGwpKSkscltvXT1sLGx9KSkoKX19LFJv
bGxiYXI6Y319LGZ1bmN0aW9uKHIsZSxvKXsidXNlIHN0cmljdCI7ZnVuY3Rpb24gbihyLGUsbyxu
KXtyLl9yb2xsYmFyV3JhcHBlZEVycm9yJiYobls0XXx8KG5bNF09ci5fcm9sbGJhcldyYXBwZWRF
cnJvciksbls1XXx8KG5bNV09ci5fcm9sbGJhcldyYXBwZWRFcnJvci5fcm9sbGJhckNvbnRleHQp
LHIuX3JvbGxiYXJXcmFwcGVkRXJyb3I9bnVsbCk7dmFyIHQ9ZS5oYW5kbGVVbmNhdWdodEV4Y2Vw
dGlvbi5hcHBseShlLG4pO28mJm8uYXBwbHkocixuKSwiYW5vbnltb3VzIj09PXQmJihlLmFub255
bW91c0Vycm9yc1BlbmRpbmcrPTEpfXIuZXhwb3J0cz17Y2FwdHVyZVVuY2F1Z2h0RXhjZXB0aW9u
czpmdW5jdGlvbihyLGUsbyl7aWYocil7dmFyIHQ7aWYoImZ1bmN0aW9uIj09dHlwZW9mIGUuX3Jv
bGxiYXJPbGRPbkVycm9yKXQ9ZS5fcm9sbGJhck9sZE9uRXJyb3I7ZWxzZSBpZihyLm9uZXJyb3Ip
e2Zvcih0PXIub25lcnJvcjt0Ll9yb2xsYmFyT2xkT25FcnJvcjspdD10Ll9yb2xsYmFyT2xkT25F
cnJvcjtlLl9yb2xsYmFyT2xkT25FcnJvcj10fWUuaGFuZGxlQW5vbnltb3VzRXJyb3JzKCk7dmFy
IGE9ZnVuY3Rpb24oKXt2YXIgbz1BcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMs
MCk7bihyLGUsdCxvKX07byYmKGEuX3JvbGxiYXJPbGRPbkVycm9yPXQpLHIub25lcnJvcj1hfX0s
Y2FwdHVyZVVuaGFuZGxlZFJlamVjdGlvbnM6ZnVuY3Rpb24ocixlLG8pe2lmKHIpeyJmdW5jdGlv
biI9PXR5cGVvZiByLl9yb2xsYmFyVVJIJiZyLl9yb2xsYmFyVVJILmJlbG9uZ3NUb1NoaW0mJnIu
cmVtb3ZlRXZlbnRMaXN0ZW5lcigidW5oYW5kbGVkcmVqZWN0aW9uIixyLl9yb2xsYmFyVVJIKTt2
YXIgbj1mdW5jdGlvbihyKXt2YXIgbyxuLHQ7dHJ5e289ci5yZWFzb259Y2F0Y2gocil7bz12b2lk
IDB9dHJ5e249ci5wcm9taXNlfWNhdGNoKHIpe249Ilt1bmhhbmRsZWRyZWplY3Rpb25dIGVycm9y
IGdldHRpbmcgYHByb21pc2VgIGZyb20gZXZlbnQifXRyeXt0PXIuZGV0YWlsLCFvJiZ0JiYobz10
LnJlYXNvbixuPXQucHJvbWlzZSl9Y2F0Y2gocil7fW98fChvPSJbdW5oYW5kbGVkcmVqZWN0aW9u
XSBlcnJvciBnZXR0aW5nIGByZWFzb25gIGZyb20gZXZlbnQiKSxlJiZlLmhhbmRsZVVuaGFuZGxl
ZFJlamVjdGlvbiYmZS5oYW5kbGVVbmhhbmRsZWRSZWplY3Rpb24obyxuKX07bi5iZWxvbmdzVG9T
aGltPW8sci5fcm9sbGJhclVSSD1uLHIuYWRkRXZlbnRMaXN0ZW5lcigidW5oYW5kbGVkcmVqZWN0
aW9uIixuKX19fX0sZnVuY3Rpb24ocixlLG8peyJ1c2Ugc3RyaWN0IjtmdW5jdGlvbiBuKHIsZSxv
KXtpZihlLmhhc093blByb3BlcnR5JiZlLmhhc093blByb3BlcnR5KCJhZGRFdmVudExpc3RlbmVy
Iikpe2Zvcih2YXIgbj1lLmFkZEV2ZW50TGlzdGVuZXI7bi5fcm9sbGJhck9sZEFkZCYmbi5iZWxv
bmdzVG9TaGltOyluPW4uX3JvbGxiYXJPbGRBZGQ7dmFyIHQ9ZnVuY3Rpb24oZSxvLHQpe24uY2Fs
bCh0aGlzLGUsci53cmFwKG8pLHQpfTt0Ll9yb2xsYmFyT2xkQWRkPW4sdC5iZWxvbmdzVG9TaGlt
PW8sZS5hZGRFdmVudExpc3RlbmVyPXQ7Zm9yKHZhciBhPWUucmVtb3ZlRXZlbnRMaXN0ZW5lcjth
Ll9yb2xsYmFyT2xkUmVtb3ZlJiZhLmJlbG9uZ3NUb1NoaW07KWE9YS5fcm9sbGJhck9sZFJlbW92
ZTt2YXIgbD1mdW5jdGlvbihyLGUsbyl7YS5jYWxsKHRoaXMscixlJiZlLl9yb2xsYmFyX3dyYXBw
ZWR8fGUsbyl9O2wuX3JvbGxiYXJPbGRSZW1vdmU9YSxsLmJlbG9uZ3NUb1NoaW09byxlLnJlbW92
ZUV2ZW50TGlzdGVuZXI9bH19ci5leHBvcnRzPWZ1bmN0aW9uKHIsZSxvKXtpZihyKXt2YXIgdCxh
LGw9IkV2ZW50VGFyZ2V0LFdpbmRvdyxOb2RlLEFwcGxpY2F0aW9uQ2FjaGUsQXVkaW9UcmFja0xp
c3QsQ2hhbm5lbE1lcmdlck5vZGUsQ3J5cHRvT3BlcmF0aW9uLEV2ZW50U291cmNlLEZpbGVSZWFk
ZXIsSFRNTFVua25vd25FbGVtZW50LElEQkRhdGFiYXNlLElEQlJlcXVlc3QsSURCVHJhbnNhY3Rp
b24sS2V5T3BlcmF0aW9uLE1lZGlhQ29udHJvbGxlcixNZXNzYWdlUG9ydCxNb2RhbFdpbmRvdyxO
b3RpZmljYXRpb24sU1ZHRWxlbWVudEluc3RhbmNlLFNjcmVlbixUZXh0VHJhY2ssVGV4dFRyYWNr
Q3VlLFRleHRUcmFja0xpc3QsV2ViU29ja2V0LFdlYlNvY2tldFdvcmtlcixXb3JrZXIsWE1MSHR0
cFJlcXVlc3QsWE1MSHR0cFJlcXVlc3RFdmVudFRhcmdldCxYTUxIdHRwUmVxdWVzdFVwbG9hZCIu
c3BsaXQoIiwiKTtmb3IodD0wO3Q8bC5sZW5ndGg7Kyt0KXJbYT1sW3RdXSYmclthXS5wcm90b3R5
cGUmJm4oZSxyW2FdLnByb3RvdHlwZSxvKX19fSxmdW5jdGlvbihyLGUsbyl7InVzZSBzdHJpY3Qi
O2Z1bmN0aW9uIG4ocixlKXt0aGlzLmltcGw9cihlLHRoaXMpLHRoaXMub3B0aW9ucz1lLGZ1bmN0
aW9uKHIpe2Zvcih2YXIgZT1mdW5jdGlvbihyKXtyZXR1cm4gZnVuY3Rpb24oKXt2YXIgZT1BcnJh
eS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsMCk7aWYodGhpcy5pbXBsW3JdKXJldHVy
biB0aGlzLmltcGxbcl0uYXBwbHkodGhpcy5pbXBsLGUpfX0sbz0ibG9nLGRlYnVnLGluZm8sd2Fy
bix3YXJuaW5nLGVycm9yLGNyaXRpY2FsLGdsb2JhbCxjb25maWd1cmUsaGFuZGxlVW5jYXVnaHRF
eGNlcHRpb24saGFuZGxlQW5vbnltb3VzRXJyb3JzLGhhbmRsZVVuaGFuZGxlZFJlamVjdGlvbixf
Y3JlYXRlSXRlbSx3cmFwLGxvYWRGdWxsLHNoaW1JZCxjYXB0dXJlRXZlbnQsY2FwdHVyZURvbUNv
bnRlbnRMb2FkZWQsY2FwdHVyZUxvYWQiLnNwbGl0KCIsIiksbj0wO248by5sZW5ndGg7bisrKXJb
b1tuXV09ZShvW25dKX0obi5wcm90b3R5cGUpfW4ucHJvdG90eXBlLl9zd2FwQW5kUHJvY2Vzc01l
c3NhZ2VzPWZ1bmN0aW9uKHIsZSl7dmFyIG8sbix0O2Zvcih0aGlzLmltcGw9cih0aGlzLm9wdGlv
bnMpO289ZS5zaGlmdCgpOyluPW8ubWV0aG9kLHQ9by5hcmdzLHRoaXNbbl0mJiJmdW5jdGlvbiI9
PXR5cGVvZiB0aGlzW25dJiYoImNhcHR1cmVEb21Db250ZW50TG9hZGVkIj09PW58fCJjYXB0dXJl
TG9hZCI9PT1uP3RoaXNbbl0uYXBwbHkodGhpcyxbdFswXSxvLnRzXSk6dGhpc1tuXS5hcHBseSh0
aGlzLHQpKTtyZXR1cm4gdGhpc30sci5leHBvcnRzPW59LGZ1bmN0aW9uKHIsZSxvKXsidXNlIHN0
cmljdCI7ci5leHBvcnRzPWZ1bmN0aW9uKHIpe3JldHVybiBmdW5jdGlvbihlKXtpZighZSYmIXdp
bmRvdy5fcm9sbGJhckluaXRpYWxpemVkKXtmb3IodmFyIG8sbix0PShyPXJ8fHt9KS5nbG9iYWxB
bGlhc3x8IlJvbGxiYXIiLGE9d2luZG93LnJvbGxiYXIsbD1mdW5jdGlvbihyKXtyZXR1cm4gbmV3
IGEocil9LGk9MDtvPXdpbmRvdy5fcm9sbGJhclNoaW1zW2krK107KW58fChuPW8uaGFuZGxlciks
by5oYW5kbGVyLl9zd2FwQW5kUHJvY2Vzc01lc3NhZ2VzKGwsby5tZXNzYWdlcyk7d2luZG93W3Rd
PW4sd2luZG93Ll9yb2xsYmFySW5pdGlhbGl6ZWQ9ITB9fX19XSk7Ci8vIEVuZCBSb2xsYmFyIFNu
aXBwZXQ8L3NjcmlwdD48c2NyaXB0PndpbmRvdy5BbGdvbGlhT3B0cyA9IHsia2V5IjoiT0RjNE9U
RXhZakUzTWpNMk16a3pPREJoTm1FMU9XRmlZalJsWkRRNU1UTmxORE5qWXpRMFpHVTJNR0ZpTm1R
ek0yWTFOV1UwTVdZd01qUTVOakk1WW5SaFowWnBiSFJsY25NOUpUVkNKVFZDSlRJeWNIVmliR2xq
SlRJeUpUSkRKVEl5WW1GMFkyaGZkekl3TWpFbE1qSWxNa01sTWpKaWIyOXJabUZqWlY5amFHRnVi
bVZzWDJGc2JDVXlNaVV5UXlVeU1tSnZiMnRtWVdObFgyTm9ZVzV1Wld4ZllXNXViM1Z1WTJWdFpX
NTBjeVV5TWlVeVF5VXlNbUp2YjJ0bVlXTmxYMk5vWVc1dVpXeGZZMnhoYzNOcFptbGxaSE1sTWpJ
bE1rTWxNakppYjI5clptRmpaVjlqYUdGdWJtVnNYMlpsWVhSMWNtVmtKVEl5SlRKREpUSXlZbTl2
YTJaaFkyVmZZMmhoYm01bGJGOW5aVzVsY21Gc0pUSXlKVEpESlRJeVltOXZhMlpoWTJWZlkyaGhi
bTVsYkY5c1lYVnVZMmhmWW05dmEyWmhZMlVsTWpJbE1rTWxNakppYjI5clptRmpaVjlqYUdGdWJt
VnNYM0psWTNKMWFYUnBibWNsTWpJbE1rTWxNakppYjI5clptRmpaVjlqYUdGdWJtVnNYM2N5TURJ
eEpUSXlKVEpESlRJeVltOXZhMlpoWTJWZlkyaGhibTVsYkY5M01qQXlNVjh6SlRJeUpUSkRKVEl5
WVdOMGFYWmxYMlp2ZFc1a1pYSnpKVEl5SlRKREpUSXlaR1JoZVY5aVlYUmphRjl6TWpBeU15VXlN
aVV5UXlVeU1tRnNiRjltYjNWdVpHVnljeVV5TWlVeVF5VXlNbmRoWVhOZllXTmpaWE56SlRJeUpU
SkRKVEl5Wm5WdVpISmhhWE5wYm1jbE1qSWxNa01sTWpKa1pXRnNjeVV6UVdGMVpHbGxibU5sSlRO
QllXeHNYMlp2ZFc1a1pYSnpKVEl5SlRKREpUSXlaR1ZoYkhNbE0wRmhkV1JwWlc1alpTVXpRV0Zq
ZEdsMlpWOW1iM1Z1WkdWeWN5VXlNaVV5UXlVeU1tUmxZV3h6SlROQmIzZHVaV1JmWW5sZmRYTmxj
aVV6UVRFNE1qZzFNeVV5TWlVeVF5VXlNbVJsWVd4ekpUTkJiM2R1WldSZllubGZZMjl0Y0dGdWVT
VXpRVEl6TVRBMUpUSXlKVFZFSlRKREpUSXlMV2hwWkdWZmFtOWljMTl3Y205bWFXeGxYMlp5YjIx
ZlkyOXRjR0Z1ZVY4eU16RTFOU1V5TWlVMVJDWjFjMlZ5Vkc5clpXNDlNVW93Vlc1d04zRm1ibVZq
ZVRWVWVtTnNOV0ZhY25Gd2VGUTVZMVZHY1ROaVlsVk5NbmxKUXlVeVFrNHdKVE5FSm1GdVlXeDVk
R2xqYzFSaFozTTlKVFZDSlRJeVltOXZhMlpoWTJVbE1qSWxNa01sTWpKaGJIVnRibWtsTWpJbE1r
TWxNakpoWTNScGRtVWxNaklsTlVRPSIsImFwcCI6IjQ1QldaSjFTR0MiLCJ0YWdfZmlsdGVycyI6
IihwdWJsaWMsYmF0Y2hfdzIwMjEsYm9va2ZhY2VfY2hhbm5lbF9hbGwsYm9va2ZhY2VfY2hhbm5l
bF9hbm5vdW5jZW1lbnRzLGJvb2tmYWNlX2NoYW5uZWxfY2xhc3NpZmllZHMsYm9va2ZhY2VfY2hh
bm5lbF9mZWF0dXJlZCxib29rZmFjZV9jaGFubmVsX2dlbmVyYWwsYm9va2ZhY2VfY2hhbm5lbF9s
YXVuY2hfYm9va2ZhY2UsYm9va2ZhY2VfY2hhbm5lbF9yZWNydWl0aW5nLGJvb2tmYWNlX2NoYW5u
ZWxfdzIwMjEsYm9va2ZhY2VfY2hhbm5lbF93MjAyMV8zLGFjdGl2ZV9mb3VuZGVycyxkZGF5X2Jh
dGNoX3MyMDIzLGFsbF9mb3VuZGVycyx3YWFzX2FjY2VzcyxmdW5kcmFpc2luZyxkZWFsczphdWRp
ZW5jZTphbGxfZm91bmRlcnMsZGVhbHM6YXVkaWVuY2U6YWN0aXZlX2ZvdW5kZXJzLGRlYWxzOm93
bmVkX2J5X3VzZXI6MTgyODUzLGRlYWxzOm93bmVkX2J5X2NvbXBhbnk6MjMxMDUsLWhpZGVfam9i
c19wcm9maWxlX2Zyb21fY29tcGFueV8yMzE1NSkifTs8L3NjcmlwdD48bWV0YSBuYW1lPSJjc3Jm
LXBhcmFtIiBjb250ZW50PSJhdXRoZW50aWNpdHlfdG9rZW4iIC8+CjxtZXRhIG5hbWU9ImNzcmYt
dG9rZW4iIGNvbnRlbnQ9InUtMnVDZmUyUFBYazkyWnVrZGtzNjJtSWpaMkJIc2xTNG1HcGhJUjFi
SEI5ek5kQmRGMEFrSnVzSW9RMU9rWW9heUtVYWtxM3BFLTZDTlBwRVpEMUd3IiAvPjxsaW5rIGhy
ZWY9Ii9hc3NldHMvZmF2aWNvbi1jOGE5MTRlZWViYTlmZTZmN2E4NjNiMzU2MDhiNTVhZWVkZDdj
MWZmNDA5Yzk3YjllY2I5NmI3YTZjMjc4ZDcwLmljbyIgcmVsPSJpY29uIiB0eXBlPSJpbWFnZS94
LWljb24iIC8+PGxpbmsgaHJlZj0iL2Fzc2V0cy9mYXZpY29uLWM4YTkxNGVlZWJhOWZlNmY3YTg2
M2IzNTYwOGI1NWFlZWRkN2MxZmY0MDljOTdiOWVjYjk2YjdhNmMyNzhkNzAuaWNvIiByZWw9InNo
b3J0Y3V0IGljb24iIHR5cGU9ImltYWdlL3gtaWNvbiIgLz48bGluayBocmVmPSIvbWFuaWZlc3Qu
anNvbiIgcmVsPSJtYW5pZmVzdCIgLz48bGluayBocmVmPSIvL2NkbmpzLmNsb3VkZmxhcmUuY29t
L2FqYXgvbGlicy9mb250LWF3ZXNvbWUvNC42LjMvY3NzL2ZvbnQtYXdlc29tZS5taW4uY3NzIiBy
ZWw9InN0eWxlc2hlZXQiIC8+PGxpbmsgaHJlZj0iLy9jZG5qcy5jbG91ZGZsYXJlLmNvbS9hamF4
L2xpYnMvaW9uaWNvbnMvMy4wLjAvY3NzL2lvbmljb25zLm1pbi5jc3MiIHJlbD0ic3R5bGVzaGVl
dCIgLz48bGluayBocmVmPSJodHRwczovL2Jvb2tmYWNlLnljb21iaW5hdG9yLmNvbS9zZWFyY2gv
b3BlbnNlYXJjaD90b2tlbj1lYTc0MmZjNy0zYmMzLTRjNTktOGU3MS04MDk4MzIyN2E1N2YiIHJl
bD0ic2VhcmNoIiB0aXRsZT0iQm9va2ZhY2UiIHR5cGU9ImFwcGxpY2F0aW9uL29wZW5zZWFyY2hk
ZXNjcmlwdGlvbit4bWwiIC8+PG1ldGEgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0
aWFsLXNjYWxlPTEsIG1heGltdW0tc2NhbGU9MSwgdXNlci1zY2FsYWJsZT1ubyIgbmFtZT0idmll
d3BvcnQiIC8+PG1ldGEgY2hhcnNldD0idXRmLTgiIC8+CjxzY3JpcHQgdHlwZT0idGV4dC9qYXZh
c2NyaXB0Ij53aW5kb3cuTlJFVU18fChOUkVVTT17fSk7TlJFVU0uaW5mbz17ImJlYWNvbiI6ImJh
bS5uci1kYXRhLm5ldCIsImVycm9yQmVhY29uIjoiYmFtLm5yLWRhdGEubmV0IiwibGljZW5zZUtl
eSI6ImY2MDRhNTI3YjAiLCJhcHBsaWNhdGlvbklEIjoiOTc5NjM0MTgiLCJ0cmFuc2FjdGlvbk5h
bWUiOiJjZzBOUWhGZVZWZ0FFeGRlVjF3SFRGOE5WVnhNIiwicXVldWVUaW1lIjowLCJhcHBsaWNh
dGlvblRpbWUiOjY5LCJhZ2VudCI6IiJ9PC9zY3JpcHQ+CjxzY3JpcHQgdHlwZT0idGV4dC9qYXZh
c2NyaXB0Ij4od2luZG93Lk5SRVVNfHwoTlJFVU09e30pKS5pbml0PXthamF4OntkZW55X2xpc3Q6
WyJiYW0ubnItZGF0YS5uZXQiXX19Oyh3aW5kb3cuTlJFVU18fChOUkVVTT17fSkpLmxvYWRlcl9j
b25maWc9e2xpY2Vuc2VLZXk6ImY2MDRhNTI3YjAiLGFwcGxpY2F0aW9uSUQ6Ijk3OTYzNDE4In07
Oy8qISBGb3IgbGljZW5zZSBpbmZvcm1hdGlvbiBwbGVhc2Ugc2VlIG5yLWxvYWRlci1ydW0tMS4y
MzguMC5taW4uanMuTElDRU5TRS50eHQgKi8KKCgpPT57InVzZSBzdHJpY3QiO3ZhciBlLHQsbj17
NzYzOihlLHQsbik9PntuLmQodCx7UF86KCk9PmYsTXQ6KCk9PnAsQzU6KCk9PnMsREw6KCk9Pm0s
T1A6KCk9PmosbEY6KCk9PlQsWXU6KCk9PnksRGc6KCk9PmcsQ1g6KCk9PmMsR0U6KCk9PmIsc1U6
KCk9PkV9KTt2YXIgcj1uKDYzMiksaT1uKDU2Nyk7Y29uc3Qgbz17YmVhY29uOnIuY2UuYmVhY29u
LGVycm9yQmVhY29uOnIuY2UuZXJyb3JCZWFjb24sbGljZW5zZUtleTp2b2lkIDAsYXBwbGljYXRp
b25JRDp2b2lkIDAsc2E6dm9pZCAwLHF1ZXVlVGltZTp2b2lkIDAsYXBwbGljYXRpb25UaW1lOnZv
aWQgMCx0dEd1aWQ6dm9pZCAwLHVzZXI6dm9pZCAwLGFjY291bnQ6dm9pZCAwLHByb2R1Y3Q6dm9p
ZCAwLGV4dHJhOnZvaWQgMCxqc0F0dHJpYnV0ZXM6e30sdXNlckF0dHJpYnV0ZXM6dm9pZCAwLGF0
dHM6dm9pZCAwLHRyYW5zYWN0aW9uTmFtZTp2b2lkIDAsdE5hbWVQbGFpbjp2b2lkIDB9LGE9e307
ZnVuY3Rpb24gcyhlKXtpZighZSl0aHJvdyBuZXcgRXJyb3IoIkFsbCBpbmZvIG9iamVjdHMgcmVx
dWlyZSBhbiBhZ2VudCBpZGVudGlmaWVyISIpO2lmKCFhW2VdKXRocm93IG5ldyBFcnJvcigiSW5m
byBmb3IgIi5jb25jYXQoZSwiIHdhcyBuZXZlciBzZXQiKSk7cmV0dXJuIGFbZV19ZnVuY3Rpb24g
YyhlLHQpe2lmKCFlKXRocm93IG5ldyBFcnJvcigiQWxsIGluZm8gb2JqZWN0cyByZXF1aXJlIGFu
IGFnZW50IGlkZW50aWZpZXIhIik7YVtlXT0oMCxpLkQpKHQsbyksKDAsci5ReSkoZSxhW2VdLCJp
bmZvIil9dmFyIGQ9big1Nik7Y29uc3QgdT0oKT0+e2NvbnN0IGU9e2Jsb2NrU2VsZWN0b3I6Iltk
YXRhLW5yLWJsb2NrXSIsbWFza0lucHV0T3B0aW9uczp7cGFzc3dvcmQ6ITB9fTtyZXR1cm57YWxs
b3dfYmZjYWNoZTohMCxwcml2YWN5Ontjb29raWVzX2VuYWJsZWQ6ITB9LGFqYXg6e2RlbnlfbGlz
dDp2b2lkIDAsYmxvY2tfaW50ZXJuYWw6ITAsZW5hYmxlZDohMCxoYXJ2ZXN0VGltZVNlY29uZHM6
MTB9LGRpc3RyaWJ1dGVkX3RyYWNpbmc6e2VuYWJsZWQ6dm9pZCAwLGV4Y2x1ZGVfbmV3cmVsaWNf
aGVhZGVyOnZvaWQgMCxjb3JzX3VzZV9uZXdyZWxpY19oZWFkZXI6dm9pZCAwLGNvcnNfdXNlX3Ry
YWNlY29udGV4dF9oZWFkZXJzOnZvaWQgMCxhbGxvd2VkX29yaWdpbnM6dm9pZCAwfSxzZXNzaW9u
Ontkb21haW46dm9pZCAwLGV4cGlyZXNNczpkLm9ELGluYWN0aXZlTXM6ZC5IYn0sc3NsOnZvaWQg
MCxvYmZ1c2NhdGU6dm9pZCAwLGpzZXJyb3JzOntlbmFibGVkOiEwLGhhcnZlc3RUaW1lU2Vjb25k
czoxMH0sbWV0cmljczp7ZW5hYmxlZDohMH0scGFnZV9hY3Rpb246e2VuYWJsZWQ6ITAsaGFydmVz
dFRpbWVTZWNvbmRzOjMwfSxwYWdlX3ZpZXdfZXZlbnQ6e2VuYWJsZWQ6ITB9LHBhZ2Vfdmlld190
aW1pbmc6e2VuYWJsZWQ6ITAsaGFydmVzdFRpbWVTZWNvbmRzOjMwLGxvbmdfdGFzazohMX0sc2Vz
c2lvbl90cmFjZTp7ZW5hYmxlZDohMCxoYXJ2ZXN0VGltZVNlY29uZHM6MTB9LGhhcnZlc3Q6e3Rv
b01hbnlSZXF1ZXN0c0RlbGF5OjYwfSxzZXNzaW9uX3JlcGxheTp7ZW5hYmxlZDohMSxoYXJ2ZXN0
VGltZVNlY29uZHM6NjAsc2FtcGxlUmF0ZTouMSxlcnJvclNhbXBsZVJhdGU6LjEsbWFza1RleHRT
ZWxlY3RvcjoiKiIsbWFza0FsbElucHV0czohMCxnZXQgYmxvY2tDbGFzcygpe3JldHVybiJuci1i
bG9jayJ9LGdldCBpZ25vcmVDbGFzcygpe3JldHVybiJuci1pZ25vcmUifSxnZXQgbWFza1RleHRD
bGFzcygpe3JldHVybiJuci1tYXNrIn0sZ2V0IGJsb2NrU2VsZWN0b3IoKXtyZXR1cm4gZS5ibG9j
a1NlbGVjdG9yfSxzZXQgYmxvY2tTZWxlY3Rvcih0KXtlLmJsb2NrU2VsZWN0b3IrPSIsIi5jb25j
YXQodCl9LGdldCBtYXNrSW5wdXRPcHRpb25zKCl7cmV0dXJuIGUubWFza0lucHV0T3B0aW9uc30s
c2V0IG1hc2tJbnB1dE9wdGlvbnModCl7ZS5tYXNrSW5wdXRPcHRpb25zPXsuLi50LHBhc3N3b3Jk
OiEwfX19LHNwYTp7ZW5hYmxlZDohMCxoYXJ2ZXN0VGltZVNlY29uZHM6MTB9fX0sbD17fTtmdW5j
dGlvbiBmKGUpe2lmKCFlKXRocm93IG5ldyBFcnJvcigiQWxsIGNvbmZpZ3VyYXRpb24gb2JqZWN0
cyByZXF1aXJlIGFuIGFnZW50IGlkZW50aWZpZXIhIik7aWYoIWxbZV0pdGhyb3cgbmV3IEVycm9y
KCJDb25maWd1cmF0aW9uIGZvciAiLmNvbmNhdChlLCIgd2FzIG5ldmVyIHNldCIpKTtyZXR1cm4g
bFtlXX1mdW5jdGlvbiBnKGUsdCl7aWYoIWUpdGhyb3cgbmV3IEVycm9yKCJBbGwgY29uZmlndXJh
dGlvbiBvYmplY3RzIHJlcXVpcmUgYW4gYWdlbnQgaWRlbnRpZmllciEiKTtsW2VdPSgwLGkuRCko
dCx1KCkpLCgwLHIuUXkpKGUsbFtlXSwiY29uZmlnIil9ZnVuY3Rpb24gcChlLHQpe2lmKCFlKXRo
cm93IG5ldyBFcnJvcigiQWxsIGNvbmZpZ3VyYXRpb24gb2JqZWN0cyByZXF1aXJlIGFuIGFnZW50
IGlkZW50aWZpZXIhIik7dmFyIG49ZihlKTtpZihuKXtmb3IodmFyIHI9dC5zcGxpdCgiLiIpLGk9
MDtpPHIubGVuZ3RoLTE7aSsrKWlmKCJvYmplY3QiIT10eXBlb2Yobj1uW3JbaV1dKSlyZXR1cm47
bj1uW3Jbci5sZW5ndGgtMV1dfXJldHVybiBufWNvbnN0IGg9e2FjY291bnRJRDp2b2lkIDAsdHJ1
c3RLZXk6dm9pZCAwLGFnZW50SUQ6dm9pZCAwLGxpY2Vuc2VLZXk6dm9pZCAwLGFwcGxpY2F0aW9u
SUQ6dm9pZCAwLHhwaWQ6dm9pZCAwfSx2PXt9O2Z1bmN0aW9uIG0oZSl7aWYoIWUpdGhyb3cgbmV3
IEVycm9yKCJBbGwgbG9hZGVyLWNvbmZpZyBvYmplY3RzIHJlcXVpcmUgYW4gYWdlbnQgaWRlbnRp
ZmllciEiKTtpZighdltlXSl0aHJvdyBuZXcgRXJyb3IoIkxvYWRlckNvbmZpZyBmb3IgIi5jb25j
YXQoZSwiIHdhcyBuZXZlciBzZXQiKSk7cmV0dXJuIHZbZV19ZnVuY3Rpb24gYihlLHQpe2lmKCFl
KXRocm93IG5ldyBFcnJvcigiQWxsIGxvYWRlci1jb25maWcgb2JqZWN0cyByZXF1aXJlIGFuIGFn
ZW50IGlkZW50aWZpZXIhIik7dltlXT0oMCxpLkQpKHQsaCksKDAsci5ReSkoZSx2W2VdLCJsb2Fk
ZXJfY29uZmlnIil9Y29uc3QgeT0oMCxyLm1GKSgpLm87dmFyIHc9bigzODUpLEE9big4MTgpO2Nv
bnN0IHg9e2J1aWxkRW52OkEuUmUsYnl0ZXNTZW50Ont9LHF1ZXJ5Qnl0ZXNTZW50Ont9LGN1c3Rv
bVRyYW5zYWN0aW9uOnZvaWQgMCxkaXNhYmxlZDohMSxkaXN0TWV0aG9kOkEuZ0YsaXNvbGF0ZWRC
YWNrbG9nOiExLGxvYWRlclR5cGU6dm9pZCAwLG1heEJ5dGVzOjNlNCxvZmZzZXQ6TWF0aC5mbG9v
cih3Ll9BPy5wZXJmb3JtYW5jZT8udGltZU9yaWdpbnx8dy5fQT8ucGVyZm9ybWFuY2U/LnRpbWlu
Zz8ubmF2aWdhdGlvblN0YXJ0fHxEYXRlLm5vdygpKSxvbmVycm9yOnZvaWQgMCxvcmlnaW46IiIr
dy5fQS5sb2NhdGlvbixwdGlkOnZvaWQgMCxyZWxlYXNlSWRzOnt9LHNlc3Npb246dm9pZCAwLHho
cldyYXBwYWJsZToiZnVuY3Rpb24iPT10eXBlb2Ygdy5fQS5YTUxIdHRwUmVxdWVzdD8ucHJvdG90
eXBlPy5hZGRFdmVudExpc3RlbmVyLHZlcnNpb246QS5xNCxkZW55TGlzdDp2b2lkIDB9LEQ9e307
ZnVuY3Rpb24gaihlKXtpZighZSl0aHJvdyBuZXcgRXJyb3IoIkFsbCBydW50aW1lIG9iamVjdHMg
cmVxdWlyZSBhbiBhZ2VudCBpZGVudGlmaWVyISIpO2lmKCFEW2VdKXRocm93IG5ldyBFcnJvcigi
UnVudGltZSBmb3IgIi5jb25jYXQoZSwiIHdhcyBuZXZlciBzZXQiKSk7cmV0dXJuIERbZV19ZnVu
Y3Rpb24gRShlLHQpe2lmKCFlKXRocm93IG5ldyBFcnJvcigiQWxsIHJ1bnRpbWUgb2JqZWN0cyBy
ZXF1aXJlIGFuIGFnZW50IGlkZW50aWZpZXIhIik7RFtlXT0oMCxpLkQpKHQseCksKDAsci5ReSko
ZSxEW2VdLCJydW50aW1lIil9ZnVuY3Rpb24gVChlKXtyZXR1cm4gZnVuY3Rpb24oZSl7dHJ5e2Nv
bnN0IHQ9cyhlKTtyZXR1cm4hIXQubGljZW5zZUtleSYmISF0LmVycm9yQmVhY29uJiYhIXQuYXBw
bGljYXRpb25JRH1jYXRjaChlKXtyZXR1cm4hMX19KGUpfX0sNTY3OihlLHQsbik9PntuLmQodCx7
RDooKT0+aX0pO3ZhciByPW4oNTApO2Z1bmN0aW9uIGkoZSx0KXt0cnl7aWYoIWV8fCJvYmplY3Qi
IT10eXBlb2YgZSlyZXR1cm4oMCxyLlopKCJTZXR0aW5nIGEgQ29uZmlndXJhYmxlIHJlcXVpcmVz
IGFuIG9iamVjdCBhcyBpbnB1dCIpO2lmKCF0fHwib2JqZWN0IiE9dHlwZW9mIHQpcmV0dXJuKDAs
ci5aKSgiU2V0dGluZyBhIENvbmZpZ3VyYWJsZSByZXF1aXJlcyBhIG1vZGVsIHRvIHNldCBpdHMg
aW5pdGlhbCBwcm9wZXJ0aWVzIik7Y29uc3Qgbj1PYmplY3QuY3JlYXRlKE9iamVjdC5nZXRQcm90
b3R5cGVPZih0KSxPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9ycyh0KSksbz0wPT09T2Jq
ZWN0LmtleXMobikubGVuZ3RoP2U6bjtmb3IobGV0IGEgaW4gbylpZih2b2lkIDAhPT1lW2FdKXRy
eXsib2JqZWN0Ij09dHlwZW9mIGVbYV0mJiJvYmplY3QiPT10eXBlb2YgdFthXT9uW2FdPWkoZVth
XSx0W2FdKTpuW2FdPWVbYV19Y2F0Y2goZSl7KDAsci5aKSgiQW4gZXJyb3Igb2NjdXJyZWQgd2hp
bGUgc2V0dGluZyBhIHByb3BlcnR5IG9mIGEgQ29uZmlndXJhYmxlIixlKX1yZXR1cm4gbn1jYXRj
aChlKXsoMCxyLlopKCJBbiBlcnJvciBvY2N1cmVkIHdoaWxlIHNldHRpbmcgYSBDb25maWd1cmFi
bGUiLGUpfX19LDgxODooZSx0LG4pPT57bi5kKHQse1JlOigpPT5pLGdGOigpPT5vLHE0OigpPT5y
fSk7Y29uc3Qgcj0iMS4yMzguMCIsaT0iUFJPRCIsbz0iQ0ROIn0sMzg1OihlLHQsbik9PntuLmQo
dCx7SUY6KCk9PmMsTms6KCk9PnUsVHQ6KCk9PmEsX0E6KCk9Pm8saWw6KCk9PnIscEw6KCk9PnMs
djY6KCk9PmksdzE6KCk9PmR9KTtjb25zdCByPSJ1bmRlZmluZWQiIT10eXBlb2Ygd2luZG93JiYh
IXdpbmRvdy5kb2N1bWVudCxpPSJ1bmRlZmluZWQiIT10eXBlb2YgV29ya2VyR2xvYmFsU2NvcGUm
JigidW5kZWZpbmVkIiE9dHlwZW9mIHNlbGYmJnNlbGYgaW5zdGFuY2VvZiBXb3JrZXJHbG9iYWxT
Y29wZSYmc2VsZi5uYXZpZ2F0b3IgaW5zdGFuY2VvZiBXb3JrZXJOYXZpZ2F0b3J8fCJ1bmRlZmlu
ZWQiIT10eXBlb2YgZ2xvYmFsVGhpcyYmZ2xvYmFsVGhpcyBpbnN0YW5jZW9mIFdvcmtlckdsb2Jh
bFNjb3BlJiZnbG9iYWxUaGlzLm5hdmlnYXRvciBpbnN0YW5jZW9mIFdvcmtlck5hdmlnYXRvciks
bz1yP3dpbmRvdzoidW5kZWZpbmVkIiE9dHlwZW9mIFdvcmtlckdsb2JhbFNjb3BlJiYoInVuZGVm
aW5lZCIhPXR5cGVvZiBzZWxmJiZzZWxmIGluc3RhbmNlb2YgV29ya2VyR2xvYmFsU2NvcGUmJnNl
bGZ8fCJ1bmRlZmluZWQiIT10eXBlb2YgZ2xvYmFsVGhpcyYmZ2xvYmFsVGhpcyBpbnN0YW5jZW9m
IFdvcmtlckdsb2JhbFNjb3BlJiZnbG9iYWxUaGlzKSxhPShvPy5sb2NhdGlvbiwvaVBhZHxpUGhv
bmV8aVBvZC8udGVzdChuYXZpZ2F0b3IudXNlckFnZW50KSkscz1hJiYidW5kZWZpbmVkIj09dHlw
ZW9mIFNoYXJlZFdvcmtlcixjPSgoKT0+e2NvbnN0IGU9bmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRj
aCgvRmlyZWZveFsvXHNdKFxkK1wuXGQrKS8pO3JldHVybiBBcnJheS5pc0FycmF5KGUpJiZlLmxl
bmd0aD49Mj8rZVsxXTowfSkoKSxkPUJvb2xlYW4ociYmd2luZG93LmRvY3VtZW50LmRvY3VtZW50
TW9kZSksdT0hIW5hdmlnYXRvci5zZW5kQmVhY29ufSw3MTE6KGUsdCxuKT0+e24uZCh0LHt3Oigp
PT5vfSk7dmFyIHI9big1MCk7Y29uc3QgaT17YWdlbnRJZGVudGlmaWVyOiIiLGVlOnZvaWQgMH07
Y2xhc3Mgb3tjb25zdHJ1Y3RvcihlKXt0cnl7aWYoIm9iamVjdCIhPXR5cGVvZiBlKXJldHVybigw
LHIuWikoInNoYXJlZCBjb250ZXh0IHJlcXVpcmVzIGFuIG9iamVjdCBhcyBpbnB1dCIpO3RoaXMu
c2hhcmVkQ29udGV4dD17fSxPYmplY3QuYXNzaWduKHRoaXMuc2hhcmVkQ29udGV4dCxpKSxPYmpl
Y3QuZW50cmllcyhlKS5mb3JFYWNoKChlPT57bGV0W3Qsbl09ZTtPYmplY3Qua2V5cyhpKS5pbmNs
dWRlcyh0KSYmKHRoaXMuc2hhcmVkQ29udGV4dFt0XT1uKX0pKX1jYXRjaChlKXsoMCxyLlopKCJB
biBlcnJvciBvY2N1cmVkIHdoaWxlIHNldHRpbmcgU2hhcmVkQ29udGV4dCIsZSl9fX19LDA6KGUs
dCxuKT0+e24uZCh0LHtMOigpPT51LFI6KCk9PmN9KTt2YXIgcj1uKDE0OCksaT1uKDI4NCksbz1u
KDMyMiksYT1uKDMyNSk7Y29uc3Qgcz17fTtmdW5jdGlvbiBjKGUsdCl7Y29uc3Qgbj17c3RhZ2Vk
OiExLHByaW9yaXR5OmEucFt0XXx8MH07ZChlKSxzW2VdLmdldCh0KXx8c1tlXS5zZXQodCxuKX1m
dW5jdGlvbiBkKGUpe2UmJihzW2VdfHwoc1tlXT1uZXcgTWFwKSl9ZnVuY3Rpb24gdSgpe2xldCBl
PWFyZ3VtZW50cy5sZW5ndGg+MCYmdm9pZCAwIT09YXJndW1lbnRzWzBdP2FyZ3VtZW50c1swXToi
Iix0PWFyZ3VtZW50cy5sZW5ndGg+MSYmdm9pZCAwIT09YXJndW1lbnRzWzFdP2FyZ3VtZW50c1sx
XToiZmVhdHVyZSI7aWYoZChlKSwhZXx8IXNbZV0uZ2V0KHQpKXJldHVybiBhKHQpO3NbZV0uZ2V0
KHQpLnN0YWdlZD0hMDtjb25zdCBuPVsuLi5zW2VdXTtmdW5jdGlvbiBhKHQpe2NvbnN0IG49ZT9y
LmVlLmdldChlKTpyLmVlLGE9by5YLmhhbmRsZXJzO2lmKG4uYmFja2xvZyYmYSl7dmFyIHM9bi5i
YWNrbG9nW3RdLGM9YVt0XTtpZihjKXtmb3IodmFyIGQ9MDtzJiZkPHMubGVuZ3RoOysrZClsKHNb
ZF0sYyk7KDAsaS5EKShjLChmdW5jdGlvbihlLHQpeygwLGkuRCkodCwoZnVuY3Rpb24odCxuKXtu
WzBdLm9uKGUsblsxXSl9KSl9KSl9ZGVsZXRlIGFbdF0sbi5iYWNrbG9nW3RdPW51bGwsbi5lbWl0
KCJkcmFpbi0iK3QsW10pfX1uLmV2ZXJ5KChlPT57bGV0W3Qsbl09ZTtyZXR1cm4gbi5zdGFnZWR9
KSkmJihuLnNvcnQoKChlLHQpPT5lWzFdLnByaW9yaXR5LXRbMV0ucHJpb3JpdHkpKSxuLmZvckVh
Y2goKGU9PntsZXRbdF09ZTthKHQpfSkpKX1mdW5jdGlvbiBsKGUsdCl7dmFyIG49ZVsxXTsoMCxp
LkQpKHRbbl0sKGZ1bmN0aW9uKHQsbil7dmFyIHI9ZVswXTtpZihuWzBdPT09cil7dmFyIGk9blsx
XSxvPWVbM10sYT1lWzJdO2kuYXBwbHkobyxhKX19KSl9fSwxNDg6KGUsdCxuKT0+e24uZCh0LHtB
OigpPT5jLGVlOigpPT5kfSk7dmFyIHI9big2MzIpLGk9bigyMTApLG89big3NjMpO2NsYXNzIGF7
Y29uc3RydWN0b3IoZSl7dGhpcy5jb250ZXh0SWQ9ZX19dmFyIHM9bigxMTcpO2NvbnN0IGM9Im5y
QGNvbnRleHQ6Ii5jb25jYXQocy5hKSxkPWZ1bmN0aW9uIGUodCxuKXt2YXIgcj17fSxzPXt9LHU9
e30sZj0hMTt0cnl7Zj0xNj09PW4ubGVuZ3RoJiYoMCxvLk9QKShuKS5pc29sYXRlZEJhY2tsb2d9
Y2F0Y2goZSl7fXZhciBnPXtvbjpoLGFkZEV2ZW50TGlzdGVuZXI6aCxyZW1vdmVFdmVudExpc3Rl
bmVyOmZ1bmN0aW9uKGUsdCl7dmFyIG49cltlXTtpZighbilyZXR1cm47Zm9yKHZhciBpPTA7aTxu
Lmxlbmd0aDtpKyspbltpXT09PXQmJm4uc3BsaWNlKGksMSl9LGVtaXQ6ZnVuY3Rpb24oZSxuLHIs
aSxvKXshMSE9PW8mJihvPSEwKTtpZihkLmFib3J0ZWQmJiFpKXJldHVybjt0JiZvJiZ0LmVtaXQo
ZSxuLHIpO2Zvcih2YXIgYT1wKHIpLGM9dihlKSx1PWMubGVuZ3RoLGw9MDtsPHU7bCsrKWNbbF0u
YXBwbHkoYSxuKTt2YXIgZj1iKClbc1tlXV07ZiYmZi5wdXNoKFtnLGUsbixhXSk7cmV0dXJuIGF9
LGdldDptLGxpc3RlbmVyczp2LGNvbnRleHQ6cCxidWZmZXI6ZnVuY3Rpb24oZSx0KXtjb25zdCBu
PWIoKTtpZih0PXR8fCJmZWF0dXJlIixnLmFib3J0ZWQpcmV0dXJuO09iamVjdC5lbnRyaWVzKGV8
fHt9KS5mb3JFYWNoKChlPT57bGV0W3IsaV09ZTtzW2ldPXQsdCBpbiBufHwoblt0XT1bXSl9KSl9
LGFib3J0OmwsYWJvcnRlZDohMSxpc0J1ZmZlcmluZzpmdW5jdGlvbihlKXtyZXR1cm4hIWIoKVtz
W2VdXX0sZGVidWdJZDpuLGJhY2tsb2c6Zj97fTp0JiYib2JqZWN0Ij09dHlwZW9mIHQuYmFja2xv
Zz90LmJhY2tsb2c6e319O3JldHVybiBnO2Z1bmN0aW9uIHAoZSl7cmV0dXJuIGUmJmUgaW5zdGFu
Y2VvZiBhP2U6ZT8oMCxpLlgpKGUsYywoKCk9Pm5ldyBhKGMpKSk6bmV3IGEoYyl9ZnVuY3Rpb24g
aChlLHQpe3JbZV09dihlKS5jb25jYXQodCl9ZnVuY3Rpb24gdihlKXtyZXR1cm4gcltlXXx8W119
ZnVuY3Rpb24gbSh0KXtyZXR1cm4gdVt0XT11W3RdfHxlKGcsdCl9ZnVuY3Rpb24gYigpe3JldHVy
biBnLmJhY2tsb2d9fSh2b2lkIDAsImdsb2JhbEVFIiksdT0oMCxyLmZQKSgpO2Z1bmN0aW9uIGwo
KXtkLmFib3J0ZWQ9ITAsZC5iYWNrbG9nPXt9fXUuZWV8fCh1LmVlPWQpfSw1NDY6KGUsdCxuKT0+
e24uZCh0LHtFOigpPT5yLHA6KCk9Pml9KTt2YXIgcj1uKDE0OCkuZWUuZ2V0KCJoYW5kbGUiKTtm
dW5jdGlvbiBpKGUsdCxuLGksbyl7bz8oby5idWZmZXIoW2VdLGkpLG8uZW1pdChlLHQsbikpOihy
LmJ1ZmZlcihbZV0saSksci5lbWl0KGUsdCxuKSl9fSwzMjI6KGUsdCxuKT0+e24uZCh0LHtYOigp
PT5vfSk7dmFyIHI9big1NDYpO28ub249YTt2YXIgaT1vLmhhbmRsZXJzPXt9O2Z1bmN0aW9uIG8o
ZSx0LG4sbyl7YShvfHxyLkUsaSxlLHQsbil9ZnVuY3Rpb24gYShlLHQsbixpLG8pe298fChvPSJm
ZWF0dXJlIiksZXx8KGU9ci5FKTt2YXIgYT10W29dPXRbb118fHt9OyhhW25dPWFbbl18fFtdKS5w
dXNoKFtlLGldKX19LDIzOTooZSx0LG4pPT57bi5kKHQse2JQOigpPT5zLGl6OigpPT5jLG0kOigp
PT5hfSk7dmFyIHI9bigzODUpO2xldCBpPSExLG89ITE7dHJ5e2NvbnN0IGU9e2dldCBwYXNzaXZl
KCl7cmV0dXJuIGk9ITAsITF9LGdldCBzaWduYWwoKXtyZXR1cm4gbz0hMCwhMX19O3IuX0EuYWRk
RXZlbnRMaXN0ZW5lcigidGVzdCIsbnVsbCxlKSxyLl9BLnJlbW92ZUV2ZW50TGlzdGVuZXIoInRl
c3QiLG51bGwsZSl9Y2F0Y2goZSl7fWZ1bmN0aW9uIGEoZSx0KXtyZXR1cm4gaXx8bz97Y2FwdHVy
ZTohIWUscGFzc2l2ZTppLHNpZ25hbDp0fTohIWV9ZnVuY3Rpb24gcyhlLHQpe2xldCBuPWFyZ3Vt
ZW50cy5sZW5ndGg+MiYmdm9pZCAwIT09YXJndW1lbnRzWzJdJiZhcmd1bWVudHNbMl0scj1hcmd1
bWVudHMubGVuZ3RoPjM/YXJndW1lbnRzWzNdOnZvaWQgMDt3aW5kb3cuYWRkRXZlbnRMaXN0ZW5l
cihlLHQsYShuLHIpKX1mdW5jdGlvbiBjKGUsdCl7bGV0IG49YXJndW1lbnRzLmxlbmd0aD4yJiZ2
b2lkIDAhPT1hcmd1bWVudHNbMl0mJmFyZ3VtZW50c1syXSxyPWFyZ3VtZW50cy5sZW5ndGg+Mz9h
cmd1bWVudHNbM106dm9pZCAwO2RvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoZSx0LGEobixyKSl9
fSwxMTc6KGUsdCxuKT0+e24uZCh0LHthOigpPT5yfSk7Y29uc3Qgcj0oMCxuKDQwMikuUmwpKCl9
LDQwMjooZSx0LG4pPT57bi5kKHQse1JsOigpPT5hLGt5OigpPT5zfSk7dmFyIHI9bigzODUpO2Nv
bnN0IGk9Inh4eHh4eHh4LXh4eHgtNHh4eC15eHh4LXh4eHh4eHh4eHh4eCI7ZnVuY3Rpb24gbyhl
LHQpe3JldHVybiBlPzE1JmVbdF06MTYqTWF0aC5yYW5kb20oKXwwfWZ1bmN0aW9uIGEoKXtjb25z
dCBlPXIuX0E/LmNyeXB0b3x8ci5fQT8ubXNDcnlwdG87bGV0IHQsbj0wO3JldHVybiBlJiZlLmdl
dFJhbmRvbVZhbHVlcyYmKHQ9ZS5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMzEpKSks
aS5zcGxpdCgiIikubWFwKChlPT4ieCI9PT1lP28odCwrK24pLnRvU3RyaW5nKDE2KToieSI9PT1l
PygzJm8oKXw4KS50b1N0cmluZygxNik6ZSkpLmpvaW4oIiIpfWZ1bmN0aW9uIHMoZSl7Y29uc3Qg
dD1yLl9BPy5jcnlwdG98fHIuX0E/Lm1zQ3J5cHRvO2xldCBuLGk9MDt0JiZ0LmdldFJhbmRvbVZh
bHVlcyYmKG49dC5nZXRSYW5kb21WYWx1ZXMobmV3IFVpbnQ4QXJyYXkoMzEpKSk7Y29uc3QgYT1b
XTtmb3IodmFyIHM9MDtzPGU7cysrKWEucHVzaChvKG4sKytpKS50b1N0cmluZygxNikpO3JldHVy
biBhLmpvaW4oIiIpfX0sNTY6KGUsdCxuKT0+e24uZCh0LHtCcTooKT0+cixIYjooKT0+byxvRDoo
KT0+aX0pO2NvbnN0IHI9Ik5SQkEiLGk9MTQ0ZTUsbz0xOGU1fSw4OTQ6KGUsdCxuKT0+e2Z1bmN0
aW9uIHIoKXtyZXR1cm4gTWF0aC5yb3VuZChwZXJmb3JtYW5jZS5ub3coKSl9bi5kKHQse3o6KCk9
PnJ9KX0sNTA6KGUsdCxuKT0+e2Z1bmN0aW9uIHIoZSx0KXsiZnVuY3Rpb24iPT10eXBlb2YgY29u
c29sZS53YXJuJiYoY29uc29sZS53YXJuKCJOZXcgUmVsaWM6ICIuY29uY2F0KGUpKSx0JiZjb25z
b2xlLndhcm4odCkpfW4uZCh0LHtaOigpPT5yfSl9LDU4NzooZSx0LG4pPT57bi5kKHQse046KCk9
PmMsVDooKT0+ZH0pO3ZhciByPW4oMTQ4KSxpPW4oNTQ2KSxvPW4oMCksYT1uKDMyNSk7Y29uc3Qg
cz17c3RuOlthLkQuc2Vzc2lvblRyYWNlXSxlcnI6W2EuRC5qc2Vycm9ycyxhLkQubWV0cmljc10s
aW5zOlthLkQucGFnZUFjdGlvbl0sc3BhOlthLkQuc3BhXSxzcjpbYS5ELnNlc3Npb25SZXBsYXks
YS5ELnNlc3Npb25UcmFjZV19O2Z1bmN0aW9uIGMoZSx0KXtjb25zdCBuPXIuZWUuZ2V0KHQpO2Um
JiJvYmplY3QiPT10eXBlb2YgZSYmKE9iamVjdC5lbnRyaWVzKGUpLmZvckVhY2goKGU9PntsZXRb
dCxyXT1lO3ZvaWQgMD09PWRbdF0mJihzW3RdP3NbdF0uZm9yRWFjaCgoZT0+e3I/KDAsaS5wKSgi
ZmVhdC0iK3QsW10sdm9pZCAwLGUsbik6KDAsaS5wKSgiYmxvY2stIit0LFtdLHZvaWQgMCxlLG4p
LCgwLGkucCkoInJ1bXJlc3AtIit0LFtCb29sZWFuKHIpXSx2b2lkIDAsZSxuKX0pKTpyJiYoMCxp
LnApKCJmZWF0LSIrdCxbXSx2b2lkIDAsdm9pZCAwLG4pLGRbdF09Qm9vbGVhbihyKSl9KSksT2Jq
ZWN0LmtleXMocykuZm9yRWFjaCgoZT0+e3ZvaWQgMD09PWRbZV0mJihzW2VdPy5mb3JFYWNoKCh0
PT4oMCxpLnApKCJydW1yZXNwLSIrZSxbITFdLHZvaWQgMCx0LG4pKSksZFtlXT0hMSl9KSksKDAs
by5MKSh0LGEuRC5wYWdlVmlld0V2ZW50KSl9Y29uc3QgZD17fX0sMjEwOihlLHQsbik9PntuLmQo
dCx7WDooKT0+aX0pO3ZhciByPU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7ZnVuY3Rp
b24gaShlLHQsbil7aWYoci5jYWxsKGUsdCkpcmV0dXJuIGVbdF07dmFyIGk9bigpO2lmKE9iamVj
dC5kZWZpbmVQcm9wZXJ0eSYmT2JqZWN0LmtleXMpdHJ5e3JldHVybiBPYmplY3QuZGVmaW5lUHJv
cGVydHkoZSx0LHt2YWx1ZTppLHdyaXRhYmxlOiEwLGVudW1lcmFibGU6ITF9KSxpfWNhdGNoKGUp
e31yZXR1cm4gZVt0XT1pLGl9fSwyODQ6KGUsdCxuKT0+e24uZCh0LHtEOigpPT5yfSk7Y29uc3Qg
cj0oZSx0KT0+T2JqZWN0LmVudHJpZXMoZXx8e30pLm1hcCgoZT0+e2xldFtuLHJdPWU7cmV0dXJu
IHQobixyKX0pKX0sMzUxOihlLHQsbik9PntuLmQodCx7UDooKT0+b30pO3ZhciByPW4oMTQ4KTtj
b25zdCBpPSgpPT57Y29uc3QgZT1uZXcgV2Vha1NldDtyZXR1cm4odCxuKT0+e2lmKCJvYmplY3Qi
PT10eXBlb2YgbiYmbnVsbCE9PW4pe2lmKGUuaGFzKG4pKXJldHVybjtlLmFkZChuKX1yZXR1cm4g
bn19O2Z1bmN0aW9uIG8oZSl7dHJ5e3JldHVybiBKU09OLnN0cmluZ2lmeShlLGkoKSl9Y2F0Y2go
ZSl7dHJ5e3IuZWUuZW1pdCgiaW50ZXJuYWwtZXJyb3IiLFtlXSl9Y2F0Y2goZSl7fX19fSw5NjA6
KGUsdCxuKT0+e24uZCh0LHtLOigpPT5hLGI6KCk9Pm99KTt2YXIgcj1uKDIzOSk7ZnVuY3Rpb24g
aSgpe3JldHVybiJ1bmRlZmluZWQiPT10eXBlb2YgZG9jdW1lbnR8fCJjb21wbGV0ZSI9PT1kb2N1
bWVudC5yZWFkeVN0YXRlfWZ1bmN0aW9uIG8oZSx0KXtpZihpKCkpcmV0dXJuIGUoKTsoMCxyLmJQ
KSgibG9hZCIsZSx0KX1mdW5jdGlvbiBhKGUpe2lmKGkoKSlyZXR1cm4gZSgpOygwLHIuaXopKCJE
T01Db250ZW50TG9hZGVkIixlKX19LDYzMjooZSx0LG4pPT57bi5kKHQse0VaOigpPT5kLFF5Oigp
PT5jLGNlOigpPT5vLGZQOigpPT5hLGdHOigpPT51LG1GOigpPT5zfSk7dmFyIHI9big4OTQpLGk9
bigzODUpO2NvbnN0IG89e2JlYWNvbjoiYmFtLm5yLWRhdGEubmV0IixlcnJvckJlYWNvbjoiYmFt
Lm5yLWRhdGEubmV0In07ZnVuY3Rpb24gYSgpe3JldHVybiBpLl9BLk5SRVVNfHwoaS5fQS5OUkVV
TT17fSksdm9pZCAwPT09aS5fQS5uZXdyZWxpYyYmKGkuX0EubmV3cmVsaWM9aS5fQS5OUkVVTSks
aS5fQS5OUkVVTX1mdW5jdGlvbiBzKCl7bGV0IGU9YSgpO3JldHVybiBlLm98fChlLm89e1NUOmku
X0Euc2V0VGltZW91dCxTSTppLl9BLnNldEltbWVkaWF0ZSxDVDppLl9BLmNsZWFyVGltZW91dCxY
SFI6aS5fQS5YTUxIdHRwUmVxdWVzdCxSRVE6aS5fQS5SZXF1ZXN0LEVWOmkuX0EuRXZlbnQsUFI6
aS5fQS5Qcm9taXNlLE1POmkuX0EuTXV0YXRpb25PYnNlcnZlcixGRVRDSDppLl9BLmZldGNofSks
ZX1mdW5jdGlvbiBjKGUsdCxuKXtsZXQgaT1hKCk7Y29uc3Qgbz1pLmluaXRpYWxpemVkQWdlbnRz
fHx7fSxzPW9bZV18fHt9O3JldHVybiBPYmplY3Qua2V5cyhzKS5sZW5ndGh8fChzLmluaXRpYWxp
emVkQXQ9e21zOigwLHIueikoKSxkYXRlOm5ldyBEYXRlfSksaS5pbml0aWFsaXplZEFnZW50cz17
Li4ubyxbZV06ey4uLnMsW25dOnR9fSxpfWZ1bmN0aW9uIGQoZSx0KXthKClbZV09dH1mdW5jdGlv
biB1KCl7cmV0dXJuIGZ1bmN0aW9uKCl7bGV0IGU9YSgpO2NvbnN0IHQ9ZS5pbmZvfHx7fTtlLmlu
Zm89e2JlYWNvbjpvLmJlYWNvbixlcnJvckJlYWNvbjpvLmVycm9yQmVhY29uLC4uLnR9fSgpLGZ1
bmN0aW9uKCl7bGV0IGU9YSgpO2NvbnN0IHQ9ZS5pbml0fHx7fTtlLmluaXQ9ey4uLnR9fSgpLHMo
KSxmdW5jdGlvbigpe2xldCBlPWEoKTtjb25zdCB0PWUubG9hZGVyX2NvbmZpZ3x8e307ZS5sb2Fk
ZXJfY29uZmlnPXsuLi50fX0oKSxhKCl9fSw5NTY6KGUsdCxuKT0+e24uZCh0LHtOOigpPT5pfSk7
dmFyIHI9bigyMzkpO2Z1bmN0aW9uIGkoZSl7bGV0IHQ9YXJndW1lbnRzLmxlbmd0aD4xJiZ2b2lk
IDAhPT1hcmd1bWVudHNbMV0mJmFyZ3VtZW50c1sxXSxuPWFyZ3VtZW50cy5sZW5ndGg+Mj9hcmd1
bWVudHNbMl06dm9pZCAwLGk9YXJndW1lbnRzLmxlbmd0aD4zP2FyZ3VtZW50c1szXTp2b2lkIDA7
cmV0dXJuIHZvaWQoMCxyLml6KSgidmlzaWJpbGl0eWNoYW5nZSIsKGZ1bmN0aW9uKCl7aWYodCly
ZXR1cm4gdm9pZCgiaGlkZGVuIj09ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlJiZlKCkpO2UoZG9j
dW1lbnQudmlzaWJpbGl0eVN0YXRlKX0pLG4saSl9fSw4MTooZSx0LG4pPT57bi5kKHQse2dGOigp
PT5vLG1ZOigpPT5pLHQ5OigpPT5yLHZ6OigpPT5zLHhTOigpPT5hfSk7Y29uc3Qgcj1uKDMyNSku
RC5tZXRyaWNzLGk9InNtIixvPSJjbSIsYT0ic3RvcmVTdXBwb3J0YWJpbGl0eU1ldHJpY3MiLHM9
InN0b3JlRXZlbnRNZXRyaWNzIn0sNjMzOihlLHQsbik9PntuLmQodCx7RHo6KCk9PmksT0o6KCk9
PmEscXc6KCk9Pm8sdDk6KCk9PnJ9KTtjb25zdCByPW4oMzI1KS5ELnBhZ2VWaWV3RXZlbnQsaT0i
Zmlyc3RieXRlIixvPSJkb21jb250ZW50IixhPSJ3aW5kb3dsb2FkIn0sMjUxOihlLHQsbik9Pntu
LmQodCx7dDooKT0+cn0pO2NvbnN0IHI9bigzMjUpLkQucGFnZVZpZXdUaW1pbmd9LDkzODooZSx0
LG4pPT57bi5kKHQse1c6KCk9Pm99KTt2YXIgcj1uKDc2MyksaT1uKDE0OCk7Y2xhc3Mgb3tjb25z
dHJ1Y3RvcihlLHQsbil7dGhpcy5hZ2VudElkZW50aWZpZXI9ZSx0aGlzLmFnZ3JlZ2F0b3I9dCx0
aGlzLmVlPWkuZWUuZ2V0KGUsKDAsci5PUCkodGhpcy5hZ2VudElkZW50aWZpZXIpLmlzb2xhdGVk
QmFja2xvZyksdGhpcy5mZWF0dXJlTmFtZT1uLHRoaXMuYmxvY2tlZD0hMX19fSwxNDQ6KGUsdCxu
KT0+e24uZCh0LHtqOigpPT52fSk7dmFyIHI9bigzMjUpLGk9big3NjMpLG89big1NDYpLGE9bigx
NDgpLHM9big4OTQpLGM9bigwKSxkPW4oOTYwKSx1PW4oMzg1KSxsPW4oNTApLGY9big4MSksZz1u
KDYzMik7ZnVuY3Rpb24gcCgpe2NvbnN0IGU9KDAsZy5nRykoKTtbInNldEVycm9ySGFuZGxlciIs
ImZpbmlzaGVkIiwiYWRkVG9UcmFjZSIsImlubGluZUhpdCIsImFkZFJlbGVhc2UiLCJhZGRQYWdl
QWN0aW9uIiwic2V0Q3VycmVudFJvdXRlTmFtZSIsInNldFBhZ2VWaWV3TmFtZSIsInNldEN1c3Rv
bUF0dHJpYnV0ZSIsImludGVyYWN0aW9uIiwibm90aWNlRXJyb3IiLCJzZXRVc2VySWQiLCJzZXRB
cHBsaWNhdGlvblZlcnNpb24iXS5mb3JFYWNoKCh0PT57ZVt0XT1mdW5jdGlvbigpe2Zvcih2YXIg
bj1hcmd1bWVudHMubGVuZ3RoLHI9bmV3IEFycmF5KG4pLGk9MDtpPG47aSsrKXJbaV09YXJndW1l
bnRzW2ldO3JldHVybiBmdW5jdGlvbih0KXtmb3IodmFyIG49YXJndW1lbnRzLmxlbmd0aCxyPW5l
dyBBcnJheShuPjE/bi0xOjApLGk9MTtpPG47aSsrKXJbaS0xXT1hcmd1bWVudHNbaV07bGV0IG89
W107cmV0dXJuIE9iamVjdC52YWx1ZXMoZS5pbml0aWFsaXplZEFnZW50cykuZm9yRWFjaCgoZT0+
e2UuZXhwb3NlZCYmZS5hcGlbdF0mJm8ucHVzaChlLmFwaVt0XSguLi5yKSl9KSksby5sZW5ndGg+
MT9vOm9bMF19KHQsLi4ucil9fSkpfXZhciBoPW4oNTg3KTtmdW5jdGlvbiB2KGUpe2xldCB0PWFy
Z3VtZW50cy5sZW5ndGg+MSYmdm9pZCAwIT09YXJndW1lbnRzWzFdP2FyZ3VtZW50c1sxXTp7fSx2
PWFyZ3VtZW50cy5sZW5ndGg+Mj9hcmd1bWVudHNbMl06dm9pZCAwLG09YXJndW1lbnRzLmxlbmd0
aD4zP2FyZ3VtZW50c1szXTp2b2lkIDAse2luaXQ6YixpbmZvOnksbG9hZGVyX2NvbmZpZzp3LHJ1
bnRpbWU6QT17bG9hZGVyVHlwZTp2fSxleHBvc2VkOng9ITB9PXQ7Y29uc3QgRD0oMCxnLmdHKSgp
O3l8fChiPUQuaW5pdCx5PUQuaW5mbyx3PUQubG9hZGVyX2NvbmZpZyksKDAsaS5EZykoZSxifHx7
fSksKDAsaS5HRSkoZSx3fHx7fSkseS5qc0F0dHJpYnV0ZXM/Pz17fSx1LnY2JiYoeS5qc0F0dHJp
YnV0ZXMuaXNXb3JrZXI9ITApLCgwLGkuQ1gpKGUseSk7Y29uc3Qgaj0oMCxpLlBfKShlKTtBLmRl
bnlMaXN0PVsuLi5qLmFqYXg/LmRlbnlfbGlzdHx8W10sLi4uai5hamF4Py5ibG9ja19pbnRlcm5h
bD9beS5iZWFjb24seS5lcnJvckJlYWNvbl06W11dLCgwLGkuc1UpKGUsQSkscCgpO2NvbnN0IEU9
ZnVuY3Rpb24oZSx0KXt0fHwoMCxjLlIpKGUsImFwaSIpO2NvbnN0IGc9e307dmFyIHA9YS5lZS5n
ZXQoZSksaD1wLmdldCgidHJhY2VyIiksdj0iYXBpLSIsbT12KyJpeG4tIjtmdW5jdGlvbiBiKHQs
bixyLG8pe2NvbnN0IGE9KDAsaS5DNSkoZSk7cmV0dXJuIG51bGw9PT1uP2RlbGV0ZSBhLmpzQXR0
cmlidXRlc1t0XTooMCxpLkNYKShlLHsuLi5hLGpzQXR0cmlidXRlczp7Li4uYS5qc0F0dHJpYnV0
ZXMsW3RdOm59fSksQSh2LHIsITAsb3x8bnVsbD09PW4/InNlc3Npb24iOnZvaWQgMCkodCxuKX1m
dW5jdGlvbiB5KCl7fVsic2V0RXJyb3JIYW5kbGVyIiwiZmluaXNoZWQiLCJhZGRUb1RyYWNlIiwi
aW5saW5lSGl0IiwiYWRkUmVsZWFzZSJdLmZvckVhY2goKGU9PmdbZV09QSh2LGUsITAsImFwaSIp
KSksZy5hZGRQYWdlQWN0aW9uPUEodiwiYWRkUGFnZUFjdGlvbiIsITAsci5ELnBhZ2VBY3Rpb24p
LGcuc2V0Q3VycmVudFJvdXRlTmFtZT1BKHYsInJvdXRlTmFtZSIsITAsci5ELnNwYSksZy5zZXRQ
YWdlVmlld05hbWU9ZnVuY3Rpb24odCxuKXtpZigic3RyaW5nIj09dHlwZW9mIHQpcmV0dXJuIi8i
IT09dC5jaGFyQXQoMCkmJih0PSIvIit0KSwoMCxpLk9QKShlKS5jdXN0b21UcmFuc2FjdGlvbj0o
bnx8Imh0dHA6Ly9jdXN0b20udHJhbnNhY3Rpb24iKSt0LEEodiwic2V0UGFnZVZpZXdOYW1lIiwh
MCkoKX0sZy5zZXRDdXN0b21BdHRyaWJ1dGU9ZnVuY3Rpb24oZSx0KXtsZXQgbj1hcmd1bWVudHMu
bGVuZ3RoPjImJnZvaWQgMCE9PWFyZ3VtZW50c1syXSYmYXJndW1lbnRzWzJdO2lmKCJzdHJpbmci
PT10eXBlb2YgZSl7aWYoWyJzdHJpbmciLCJudW1iZXIiXS5pbmNsdWRlcyh0eXBlb2YgdCl8fG51
bGw9PT10KXJldHVybiBiKGUsdCwic2V0Q3VzdG9tQXR0cmlidXRlIixuKTsoMCxsLlopKCJGYWls
ZWQgdG8gZXhlY3V0ZSBzZXRDdXN0b21BdHRyaWJ1dGUuXG5Ob24tbnVsbCB2YWx1ZSBtdXN0IGJl
IGEgc3RyaW5nIG9yIG51bWJlciB0eXBlLCBidXQgYSB0eXBlIG9mIDwiLmNvbmNhdCh0eXBlb2Yg
dCwiPiB3YXMgcHJvdmlkZWQuIikpfWVsc2UoMCxsLlopKCJGYWlsZWQgdG8gZXhlY3V0ZSBzZXRD
dXN0b21BdHRyaWJ1dGUuXG5OYW1lIG11c3QgYmUgYSBzdHJpbmcgdHlwZSwgYnV0IGEgdHlwZSBv
ZiA8Ii5jb25jYXQodHlwZW9mIGUsIj4gd2FzIHByb3ZpZGVkLiIpKX0sZy5zZXRVc2VySWQ9ZnVu
Y3Rpb24oZSl7aWYoInN0cmluZyI9PXR5cGVvZiBlfHxudWxsPT09ZSlyZXR1cm4gYigiZW5kdXNl
ci5pZCIsZSwic2V0VXNlcklkIiwhMCk7KDAsbC5aKSgiRmFpbGVkIHRvIGV4ZWN1dGUgc2V0VXNl
cklkLlxuTm9uLW51bGwgdmFsdWUgbXVzdCBiZSBhIHN0cmluZyB0eXBlLCBidXQgYSB0eXBlIG9m
IDwiLmNvbmNhdCh0eXBlb2YgZSwiPiB3YXMgcHJvdmlkZWQuIikpfSxnLnNldEFwcGxpY2F0aW9u
VmVyc2lvbj1mdW5jdGlvbihlKXtpZigic3RyaW5nIj09dHlwZW9mIGV8fG51bGw9PT1lKXJldHVy
biBiKCJhcHBsaWNhdGlvbi52ZXJzaW9uIixlLCJzZXRBcHBsaWNhdGlvblZlcnNpb24iLCExKTso
MCxsLlopKCJGYWlsZWQgdG8gZXhlY3V0ZSBzZXRBcHBsaWNhdGlvblZlcnNpb24uIEV4cGVjdGVk
IDxTdHJpbmcgfCBudWxsPiwgYnV0IGdvdCA8Ii5jb25jYXQodHlwZW9mIGUsIj4uIikpfSxnLmlu
dGVyYWN0aW9uPWZ1bmN0aW9uKCl7cmV0dXJuKG5ldyB5KS5nZXQoKX07dmFyIHc9eS5wcm90b3R5
cGU9e2NyZWF0ZVRyYWNlcjpmdW5jdGlvbihlLHQpe3ZhciBuPXt9LGk9dGhpcyxhPSJmdW5jdGlv
biI9PXR5cGVvZiB0O3JldHVybigwLG8ucCkobSsidHJhY2VyIixbKDAscy56KSgpLGUsbl0saSxy
LkQuc3BhLHApLGZ1bmN0aW9uKCl7aWYoaC5lbWl0KChhPyIiOiJuby0iKSsiZm4tc3RhcnQiLFso
MCxzLnopKCksaSxhXSxuKSxhKXRyeXtyZXR1cm4gdC5hcHBseSh0aGlzLGFyZ3VtZW50cyl9Y2F0
Y2goZSl7dGhyb3cgaC5lbWl0KCJmbi1lcnIiLFthcmd1bWVudHMsdGhpcyxlXSxuKSxlfWZpbmFs
bHl7aC5lbWl0KCJmbi1lbmQiLFsoMCxzLnopKCldLG4pfX19fTtmdW5jdGlvbiBBKGUsdCxuLGkp
e3JldHVybiBmdW5jdGlvbigpe3JldHVybigwLG8ucCkoZi54UyxbIkFQSS8iK3QrIi9jYWxsZWQi
XSx2b2lkIDAsci5ELm1ldHJpY3MscCksaSYmKDAsby5wKShlK3QsWygwLHMueikoKSwuLi5hcmd1
bWVudHNdLG4/bnVsbDp0aGlzLGkscCksbj92b2lkIDA6dGhpc319ZnVuY3Rpb24geCgpe24uZSg3
NSkudGhlbihuLmJpbmQobiw0MzgpKS50aGVuKCh0PT57bGV0e3NldEFQSTpufT10O24oZSksKDAs
Yy5MKShlLCJhcGkiKX0pKS5jYXRjaCgoKCk9PigwLGwuWikoIkRvd25sb2FkaW5nIHJ1bnRpbWUg
QVBJcyBmYWlsZWQuLi4iKSkpfXJldHVyblsiYWN0aW9uVGV4dCIsInNldE5hbWUiLCJzZXRBdHRy
aWJ1dGUiLCJzYXZlIiwiaWdub3JlIiwib25FbmQiLCJnZXRDb250ZXh0IiwiZW5kIiwiZ2V0Il0u
Zm9yRWFjaCgoZT0+e3dbZV09QShtLGUsdm9pZCAwLHIuRC5zcGEpfSkpLGcubm90aWNlRXJyb3I9
ZnVuY3Rpb24oZSx0KXsic3RyaW5nIj09dHlwZW9mIGUmJihlPW5ldyBFcnJvcihlKSksKDAsby5w
KShmLnhTLFsiQVBJL25vdGljZUVycm9yL2NhbGxlZCJdLHZvaWQgMCxyLkQubWV0cmljcyxwKSwo
MCxvLnApKCJlcnIiLFtlLCgwLHMueikoKSwhMSx0XSx2b2lkIDAsci5ELmpzZXJyb3JzLHApfSx1
LmlsPygwLGQuYikoKCgpPT54KCkpLCEwKTp4KCksZ30oZSxtKTtyZXR1cm4oMCxnLlF5KShlLEUs
ImFwaSIpLCgwLGcuUXkpKGUseCwiZXhwb3NlZCIpLCgwLGcuRVopKCJhY3RpdmF0ZWRGZWF0dXJl
cyIsaC5UKSxFfX0sMzI1OihlLHQsbik9PntuLmQodCx7RDooKT0+cixwOigpPT5pfSk7Y29uc3Qg
cj17YWpheDoiYWpheCIsanNlcnJvcnM6ImpzZXJyb3JzIixtZXRyaWNzOiJtZXRyaWNzIixwYWdl
QWN0aW9uOiJwYWdlX2FjdGlvbiIscGFnZVZpZXdFdmVudDoicGFnZV92aWV3X2V2ZW50IixwYWdl
Vmlld1RpbWluZzoicGFnZV92aWV3X3RpbWluZyIsc2Vzc2lvblJlcGxheToic2Vzc2lvbl9yZXBs
YXkiLHNlc3Npb25UcmFjZToic2Vzc2lvbl90cmFjZSIsc3BhOiJzcGEifSxpPXtbci5wYWdlVmll
d0V2ZW50XToxLFtyLnBhZ2VWaWV3VGltaW5nXToyLFtyLm1ldHJpY3NdOjMsW3IuanNlcnJvcnNd
OjQsW3IuYWpheF06NSxbci5zZXNzaW9uVHJhY2VdOjYsW3IucGFnZUFjdGlvbl06Nyxbci5zcGFd
OjgsW3Iuc2Vzc2lvblJlcGxheV06OX19fSxyPXt9O2Z1bmN0aW9uIGkoZSl7dmFyIHQ9cltlXTtp
Zih2b2lkIDAhPT10KXJldHVybiB0LmV4cG9ydHM7dmFyIG89cltlXT17ZXhwb3J0czp7fX07cmV0
dXJuIG5bZV0obyxvLmV4cG9ydHMsaSksby5leHBvcnRzfWkubT1uLGkuZD0oZSx0KT0+e2Zvcih2
YXIgbiBpbiB0KWkubyh0LG4pJiYhaS5vKGUsbikmJk9iamVjdC5kZWZpbmVQcm9wZXJ0eShlLG4s
e2VudW1lcmFibGU6ITAsZ2V0OnRbbl19KX0saS5mPXt9LGkuZT1lPT5Qcm9taXNlLmFsbChPYmpl
Y3Qua2V5cyhpLmYpLnJlZHVjZSgoKHQsbik9PihpLmZbbl0oZSx0KSx0KSksW10pKSxpLnU9ZT0+
Im5yLXJ1bS4zNzA5Y2I3NS0xLjIzOC4wLm1pbi5qcyIsaS5vPShlLHQpPT5PYmplY3QucHJvdG90
eXBlLmhhc093blByb3BlcnR5LmNhbGwoZSx0KSxlPXt9LHQ9Ik5SQkEtMS4yMzguMC5QUk9EOiIs
aS5sPShuLHIsbyxhKT0+e2lmKGVbbl0pZVtuXS5wdXNoKHIpO2Vsc2V7dmFyIHMsYztpZih2b2lk
IDAhPT1vKWZvcih2YXIgZD1kb2N1bWVudC5nZXRFbGVtZW50c0J5VGFnTmFtZSgic2NyaXB0Iiks
dT0wO3U8ZC5sZW5ndGg7dSsrKXt2YXIgbD1kW3VdO2lmKGwuZ2V0QXR0cmlidXRlKCJzcmMiKT09
bnx8bC5nZXRBdHRyaWJ1dGUoImRhdGEtd2VicGFjayIpPT10K28pe3M9bDticmVha319c3x8KGM9
ITAsKHM9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic2NyaXB0IikpLmNoYXJzZXQ9InV0Zi04Iixz
LnRpbWVvdXQ9MTIwLGkubmMmJnMuc2V0QXR0cmlidXRlKCJub25jZSIsaS5uYykscy5zZXRBdHRy
aWJ1dGUoImRhdGEtd2VicGFjayIsdCtvKSxzLnNyYz1uKSxlW25dPVtyXTt2YXIgZj0odCxyDQo2
ZmQzDQopPT57cy5vbmVycm9yPXMub25sb2FkPW51bGwsY2xlYXJUaW1lb3V0KGcpO3ZhciBpPWVb
bl07aWYoZGVsZXRlIGVbbl0scy5wYXJlbnROb2RlJiZzLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQo
cyksaSYmaS5mb3JFYWNoKChlPT5lKHIpKSksdClyZXR1cm4gdChyKX0sZz1zZXRUaW1lb3V0KGYu
YmluZChudWxsLHZvaWQgMCx7dHlwZToidGltZW91dCIsdGFyZ2V0OnN9KSwxMmU0KTtzLm9uZXJy
b3I9Zi5iaW5kKG51bGwscy5vbmVycm9yKSxzLm9ubG9hZD1mLmJpbmQobnVsbCxzLm9ubG9hZCks
YyYmZG9jdW1lbnQuaGVhZC5hcHBlbmRDaGlsZChzKX19LGkucj1lPT57InVuZGVmaW5lZCIhPXR5
cGVvZiBTeW1ib2wmJlN5bWJvbC50b1N0cmluZ1RhZyYmT2JqZWN0LmRlZmluZVByb3BlcnR5KGUs
U3ltYm9sLnRvU3RyaW5nVGFnLHt2YWx1ZToiTW9kdWxlIn0pLE9iamVjdC5kZWZpbmVQcm9wZXJ0
eShlLCJfX2VzTW9kdWxlIix7dmFsdWU6ITB9KX0saS5wPSJodHRwczovL2pzLWFnZW50Lm5ld3Jl
bGljLmNvbS8iLCgoKT0+e3ZhciBlPXs1MDowLDgzMjowfTtpLmYuaj0odCxuKT0+e3ZhciByPWku
byhlLHQpP2VbdF06dm9pZCAwO2lmKDAhPT1yKWlmKHIpbi5wdXNoKHJbMl0pO2Vsc2V7dmFyIG89
bmV3IFByb21pc2UoKChuLGkpPT5yPWVbdF09W24saV0pKTtuLnB1c2goclsyXT1vKTt2YXIgYT1p
LnAraS51KHQpLHM9bmV3IEVycm9yO2kubChhLChuPT57aWYoaS5vKGUsdCkmJigwIT09KHI9ZVt0
XSkmJihlW3RdPXZvaWQgMCkscikpe3ZhciBvPW4mJigibG9hZCI9PT1uLnR5cGU/Im1pc3Npbmci
Om4udHlwZSksYT1uJiZuLnRhcmdldCYmbi50YXJnZXQuc3JjO3MubWVzc2FnZT0iTG9hZGluZyBj
aHVuayAiK3QrIiBmYWlsZWQuXG4oIitvKyI6ICIrYSsiKSIscy5uYW1lPSJDaHVua0xvYWRFcnJv
ciIscy50eXBlPW8scy5yZXF1ZXN0PWEsclsxXShzKX19KSwiY2h1bmstIit0LHQpfX07dmFyIHQ9
KHQsbik9Pnt2YXIgcixvLFthLHMsY109bixkPTA7aWYoYS5zb21lKCh0PT4wIT09ZVt0XSkpKXtm
b3IociBpbiBzKWkubyhzLHIpJiYoaS5tW3JdPXNbcl0pO2lmKGMpYyhpKX1mb3IodCYmdChuKTtk
PGEubGVuZ3RoO2QrKylvPWFbZF0saS5vKGUsbykmJmVbb10mJmVbb11bMF0oKSxlW29dPTB9LG49
c2VsZlsid2VicGFja0NodW5rOk5SQkEtMS4yMzguMC5QUk9EIl09c2VsZlsid2VicGFja0NodW5r
Ok5SQkEtMS4yMzguMC5QUk9EIl18fFtdO24uZm9yRWFjaCh0LmJpbmQobnVsbCwwKSksbi5wdXNo
PXQuYmluZChudWxsLG4ucHVzaC5iaW5kKG4pKX0pKCksKCgpPT57dmFyIGU9aSg1MCk7Y2xhc3Mg
dHthZGRQYWdlQWN0aW9uKHQsbil7KDAsZS5aKSgiQ2FsbCB0byBhZ2VudCBhcGkgYWRkUGFnZUFj
dGlvbiBmYWlsZWQuIFRoZSBzZXNzaW9uIHRyYWNlIGZlYXR1cmUgaXMgbm90IGN1cnJlbnRseSBp
bml0aWFsaXplZC4iKX1zZXRQYWdlVmlld05hbWUodCxuKXsoMCxlLlopKCJDYWxsIHRvIGFnZW50
IGFwaSBzZXRQYWdlVmlld05hbWUgZmFpbGVkLiBUaGUgcGFnZSB2aWV3IGZlYXR1cmUgaXMgbm90
IGN1cnJlbnRseSBpbml0aWFsaXplZC4iKX1zZXRDdXN0b21BdHRyaWJ1dGUodCxuLHIpeygwLGUu
WikoIkNhbGwgdG8gYWdlbnQgYXBpIHNldEN1c3RvbUF0dHJpYnV0ZSBmYWlsZWQuIFRoZSBqcyBl
cnJvcnMgZmVhdHVyZSBpcyBub3QgY3VycmVudGx5IGluaXRpYWxpemVkLiIpfW5vdGljZUVycm9y
KHQsbil7KDAsZS5aKSgiQ2FsbCB0byBhZ2VudCBhcGkgbm90aWNlRXJyb3IgZmFpbGVkLiBUaGUg
anMgZXJyb3JzIGZlYXR1cmUgaXMgbm90IGN1cnJlbnRseSBpbml0aWFsaXplZC4iKX1zZXRVc2Vy
SWQodCl7KDAsZS5aKSgiQ2FsbCB0byBhZ2VudCBhcGkgc2V0VXNlcklkIGZhaWxlZC4gVGhlIGpz
IGVycm9ycyBmZWF0dXJlIGlzIG5vdCBjdXJyZW50bHkgaW5pdGlhbGl6ZWQuIil9c2V0QXBwbGlj
YXRpb25WZXJzaW9uKHQpeygwLGUuWikoIkNhbGwgdG8gYWdlbnQgYXBpIHNldEFwcGxpY2F0aW9u
VmVyc2lvbiBmYWlsZWQuIFRoZSBhZ2VudCBpcyBub3QgY3VycmVudGx5IGluaXRpYWxpemVkLiIp
fXNldEVycm9ySGFuZGxlcih0KXsoMCxlLlopKCJDYWxsIHRvIGFnZW50IGFwaSBzZXRFcnJvckhh
bmRsZXIgZmFpbGVkLiBUaGUganMgZXJyb3JzIGZlYXR1cmUgaXMgbm90IGN1cnJlbnRseSBpbml0
aWFsaXplZC4iKX1maW5pc2hlZCh0KXsoMCxlLlopKCJDYWxsIHRvIGFnZW50IGFwaSBmaW5pc2hl
ZCBmYWlsZWQuIFRoZSBwYWdlIGFjdGlvbiBmZWF0dXJlIGlzIG5vdCBjdXJyZW50bHkgaW5pdGlh
bGl6ZWQuIil9YWRkUmVsZWFzZSh0LG4peygwLGUuWikoIkNhbGwgdG8gYWdlbnQgYXBpIGFkZFJl
bGVhc2UgZmFpbGVkLiBUaGUgYWdlbnQgaXMgbm90IGN1cnJlbnRseSBpbml0aWFsaXplZC4iKX19
dmFyIG49aSgzMjUpLHI9aSg3NjMpO2NvbnN0IG89T2JqZWN0LnZhbHVlcyhuLkQpO2Z1bmN0aW9u
IGEoZSl7Y29uc3QgdD17fTtyZXR1cm4gby5mb3JFYWNoKChuPT57dFtuXT1mdW5jdGlvbihlLHQp
e3JldHVybiExIT09KDAsci5NdCkodCwiIi5jb25jYXQoZSwiLmVuYWJsZWQiKSl9KG4sZSl9KSks
dH12YXIgcz1pKDE0NCk7dmFyIGM9aSg1NDYpLGQ9aSgzODUpLHU9aSgwKSxsPWkoOTM4KSxmPWko
OTYwKTtjbGFzcyBnIGV4dGVuZHMgbC5Xe2NvbnN0cnVjdG9yKGUsdCxuKXtsZXQgcj0hKGFyZ3Vt
ZW50cy5sZW5ndGg+MyYmdm9pZCAwIT09YXJndW1lbnRzWzNdKXx8YXJndW1lbnRzWzNdO3N1cGVy
KGUsdCxuKSx0aGlzLmF1dG89cix0aGlzLmFib3J0SGFuZGxlcix0aGlzLmZlYXRBZ2dyZWdhdGUs
dGhpcy5vbkFnZ3JlZ2F0ZUltcG9ydGVkLHImJigwLHUuUikoZSxuKX1pbXBvcnRBZ2dyZWdhdG9y
KCl7bGV0IHQ9YXJndW1lbnRzLmxlbmd0aD4wJiZ2b2lkIDAhPT1hcmd1bWVudHNbMF0/YXJndW1l
bnRzWzBdOnt9O2lmKHRoaXMuZmVhdEFnZ3JlZ2F0ZXx8IXRoaXMuYXV0bylyZXR1cm47Y29uc3Qg
bj1kLmlsJiYhMD09PSgwLHIuTXQpKHRoaXMuYWdlbnRJZGVudGlmaWVyLCJwcml2YWN5LmNvb2tp
ZXNfZW5hYmxlZCIpO2xldCBvO3RoaXMub25BZ2dyZWdhdGVJbXBvcnRlZD1uZXcgUHJvbWlzZSgo
ZT0+e289ZX0pKTtjb25zdCBhPWFzeW5jKCk9PntsZXQgcjt0cnl7aWYobil7Y29uc3R7c2V0dXBB
Z2VudFNlc3Npb246ZX09YXdhaXQgaS5lKDc1KS50aGVuKGkuYmluZChpLDIyOCkpO3I9ZSh0aGlz
LmFnZW50SWRlbnRpZmllcil9fWNhdGNoKHQpeygwLGUuWikoIkEgcHJvYmxlbSBvY2N1cnJlZCB3
aGVuIHN0YXJ0aW5nIHVwIHNlc3Npb24gbWFuYWdlci4gVGhpcyBwYWdlIHdpbGwgbm90IHN0YXJ0
IG9yIGV4dGVuZCBhbnkgc2Vzc2lvbi4iLHQpfXRyeXtpZighdGhpcy5zaG91bGRJbXBvcnRBZ2co
dGhpcy5mZWF0dXJlTmFtZSxyKSlyZXR1cm4oMCx1LkwpKHRoaXMuYWdlbnRJZGVudGlmaWVyLHRo
aXMuZmVhdHVyZU5hbWUpLHZvaWQgbyghMSk7Y29uc3R7bGF6eUZlYXR1cmVMb2FkZXI6ZX09YXdh
aXQgaS5lKDc1KS50aGVuKGkuYmluZChpLDU4MikpLHtBZ2dyZWdhdGU6bn09YXdhaXQgZSh0aGlz
LmZlYXR1cmVOYW1lLCJhZ2dyZWdhdGUiKTt0aGlzLmZlYXRBZ2dyZWdhdGU9bmV3IG4odGhpcy5h
Z2VudElkZW50aWZpZXIsdGhpcy5hZ2dyZWdhdG9yLHQpLG8oITApfWNhdGNoKHQpeygwLGUuWiko
IkRvd25sb2FkaW5nIGFuZCBpbml0aWFsaXppbmcgIi5jb25jYXQodGhpcy5mZWF0dXJlTmFtZSwi
IGZhaWxlZC4uLiIpLHQpLHRoaXMuYWJvcnRIYW5kbGVyPy4oKSxvKCExKX19O2QuaWw/KDAsZi5i
KSgoKCk9PmEoKSksITApOmEoKX1zaG91bGRJbXBvcnRBZ2coZSx0KXtyZXR1cm4gZSE9PW4uRC5z
ZXNzaW9uUmVwbGF5fHwhIXIuWXUuTU8mJighMSE9PSgwLHIuTXQpKHRoaXMuYWdlbnRJZGVudGlm
aWVyLCJzZXNzaW9uX3RyYWNlLmVuYWJsZWQiKSYmKCEhdD8uaXNOZXd8fCEhdD8uc3RhdGUuc2Vz
c2lvblJlcGxheSkpfX12YXIgcD1pKDYzMyksaD1pKDg5NCk7Y2xhc3MgdiBleHRlbmRzIGd7c3Rh
dGljIGZlYXR1cmVOYW1lPXAudDk7Y29uc3RydWN0b3IoZSx0KXtsZXQgaT0hKGFyZ3VtZW50cy5s
ZW5ndGg+MiYmdm9pZCAwIT09YXJndW1lbnRzWzJdKXx8YXJndW1lbnRzWzJdO2lmKHN1cGVyKGUs
dCxwLnQ5LGkpLCgidW5kZWZpbmVkIj09dHlwZW9mIFBlcmZvcm1hbmNlTmF2aWdhdGlvblRpbWlu
Z3x8ZC5UdCkmJiJ1bmRlZmluZWQiIT10eXBlb2YgUGVyZm9ybWFuY2VUaW1pbmcpe2NvbnN0IHQ9
KDAsci5PUCkoZSk7dFtwLkR6XT1NYXRoLm1heChEYXRlLm5vdygpLXQub2Zmc2V0LDApLCgwLGYu
SykoKCgpPT50W3AucXddPU1hdGgubWF4KCgwLGgueikoKS10W3AuRHpdLDApKSksKDAsZi5iKSgo
KCk9Pntjb25zdCBlPSgwLGgueikoKTt0W3AuT0pdPU1hdGgubWF4KGUtdFtwLkR6XSwwKSwoMCxj
LnApKCJ0aW1pbmciLFsibG9hZCIsZV0sdm9pZCAwLG4uRC5wYWdlVmlld1RpbWluZyx0aGlzLmVl
KX0pKX10aGlzLmltcG9ydEFnZ3JlZ2F0b3IoKX19dmFyIG09aSg3MTEpLGI9aSgyODQpO2NsYXNz
IHkgZXh0ZW5kcyBtLnd7Y29uc3RydWN0b3IoZSl7c3VwZXIoZSksdGhpcy5hZ2dyZWdhdGVkRGF0
YT17fX1zdG9yZShlLHQsbixyLGkpe3ZhciBvPXRoaXMuZ2V0QnVja2V0KGUsdCxuLGkpO3JldHVy
biBvLm1ldHJpY3M9ZnVuY3Rpb24oZSx0KXt0fHwodD17Y291bnQ6MH0pO3JldHVybiB0LmNvdW50
Kz0xLCgwLGIuRCkoZSwoZnVuY3Rpb24oZSxuKXt0W2VdPXcobix0W2VdKX0pKSx0fShyLG8ubWV0
cmljcyksb31tZXJnZShlLHQsbixyLGkpe3ZhciBvPXRoaXMuZ2V0QnVja2V0KGUsdCxyLGkpO2lm
KG8ubWV0cmljcyl7dmFyIGE9by5tZXRyaWNzO2EuY291bnQrPW4uY291bnQsKDAsYi5EKShuLChm
dW5jdGlvbihlLHQpe2lmKCJjb3VudCIhPT1lKXt2YXIgcj1hW2VdLGk9bltlXTtpJiYhaS5jP2Fb
ZV09dyhpLnQscik6YVtlXT1mdW5jdGlvbihlLHQpe2lmKCF0KXJldHVybiBlO3QuY3x8KHQ9QSh0
LnQpKTtyZXR1cm4gdC5taW49TWF0aC5taW4oZS5taW4sdC5taW4pLHQubWF4PU1hdGgubWF4KGUu
bWF4LHQubWF4KSx0LnQrPWUudCx0LnNvcys9ZS5zb3MsdC5jKz1lLmMsdH0oaSxhW2VdKX19KSl9
ZWxzZSBvLm1ldHJpY3M9bn1zdG9yZU1ldHJpYyhlLHQsbixyKXt2YXIgaT10aGlzLmdldEJ1Y2tl
dChlLHQsbik7cmV0dXJuIGkuc3RhdHM9dyhyLGkuc3RhdHMpLGl9Z2V0QnVja2V0KGUsdCxuLHIp
e3RoaXMuYWdncmVnYXRlZERhdGFbZV18fCh0aGlzLmFnZ3JlZ2F0ZWREYXRhW2VdPXt9KTt2YXIg
aT10aGlzLmFnZ3JlZ2F0ZWREYXRhW2VdW3RdO3JldHVybiBpfHwoaT10aGlzLmFnZ3JlZ2F0ZWRE
YXRhW2VdW3RdPXtwYXJhbXM6bnx8e319LHImJihpLmN1c3RvbT1yKSksaX1nZXQoZSx0KXtyZXR1
cm4gdD90aGlzLmFnZ3JlZ2F0ZWREYXRhW2VdJiZ0aGlzLmFnZ3JlZ2F0ZWREYXRhW2VdW3RdOnRo
aXMuYWdncmVnYXRlZERhdGFbZV19dGFrZShlKXtmb3IodmFyIHQ9e30sbj0iIixyPSExLGk9MDtp
PGUubGVuZ3RoO2krKyl0W249ZVtpXV09eCh0aGlzLmFnZ3JlZ2F0ZWREYXRhW25dKSx0W25dLmxl
bmd0aCYmKHI9ITApLGRlbGV0ZSB0aGlzLmFnZ3JlZ2F0ZWREYXRhW25dO3JldHVybiByP3Q6bnVs
bH19ZnVuY3Rpb24gdyhlLHQpe3JldHVybiBudWxsPT1lP2Z1bmN0aW9uKGUpe2U/ZS5jKys6ZT17
YzoxfTtyZXR1cm4gZX0odCk6dD8odC5jfHwodD1BKHQudCkpLHQuYys9MSx0LnQrPWUsdC5zb3Mr
PWUqZSxlPnQubWF4JiYodC5tYXg9ZSksZTx0Lm1pbiYmKHQubWluPWUpLHQpOnt0OmV9fWZ1bmN0
aW9uIEEoZSl7cmV0dXJue3Q6ZSxtaW46ZSxtYXg6ZSxzb3M6ZSplLGM6MX19ZnVuY3Rpb24geChl
KXtyZXR1cm4ib2JqZWN0IiE9dHlwZW9mIGU/W106KDAsYi5EKShlLEQpfWZ1bmN0aW9uIEQoZSx0
KXtyZXR1cm4gdH12YXIgaj1pKDYzMiksRT1pKDQwMiksVD1pKDM1MSk7dmFyIF89aSg5NTYpLGs9
aSgyMzkpLFA9aSgyNTEpO2NsYXNzIEMgZXh0ZW5kcyBne3N0YXRpYyBmZWF0dXJlTmFtZT1QLnQ7
Y29uc3RydWN0b3IoZSx0KXtsZXQgbj0hKGFyZ3VtZW50cy5sZW5ndGg+MiYmdm9pZCAwIT09YXJn
dW1lbnRzWzJdKXx8YXJndW1lbnRzWzJdO3N1cGVyKGUsdCxQLnQsbiksZC5pbCYmKCgwLHIuT1Ap
KGUpLmluaXRIaWRkZW49Qm9vbGVhbigiaGlkZGVuIj09PWRvY3VtZW50LnZpc2liaWxpdHlTdGF0
ZSksKDAsXy5OKSgoKCk9PigwLGMucCkoImRvY0hpZGRlbiIsWygwLGgueikoKV0sdm9pZCAwLFAu
dCx0aGlzLmVlKSksITApLCgwLGsuYlApKCJwYWdlaGlkZSIsKCgpPT4oMCxjLnApKCJ3aW5QYWdl
aGlkZSIsWygwLGgueikoKV0sdm9pZCAwLFAudCx0aGlzLmVlKSkpLHRoaXMuaW1wb3J0QWdncmVn
YXRvcigpKX19dmFyIEk9aSg4MSk7Y2xhc3MgTiBleHRlbmRzIGd7c3RhdGljIGZlYXR1cmVOYW1l
PUkudDk7Y29uc3RydWN0b3IoZSx0KXtsZXQgbj0hKGFyZ3VtZW50cy5sZW5ndGg+MiYmdm9pZCAw
IT09YXJndW1lbnRzWzJdKXx8YXJndW1lbnRzWzJdO3N1cGVyKGUsdCxJLnQ5LG4pLHRoaXMuaW1w
b3J0QWdncmVnYXRvcigpfX1uZXcgY2xhc3MgZXh0ZW5kcyB0e2NvbnN0cnVjdG9yKHQpe2xldCBu
PWFyZ3VtZW50cy5sZW5ndGg+MSYmdm9pZCAwIT09YXJndW1lbnRzWzFdP2FyZ3VtZW50c1sxXToo
MCxFLmt5KSgxNik7c3VwZXIoKSxkLl9BPyh0aGlzLmFnZW50SWRlbnRpZmllcj1uLHRoaXMuc2hh
cmVkQWdncmVnYXRvcj1uZXcgeSh7YWdlbnRJZGVudGlmaWVyOnRoaXMuYWdlbnRJZGVudGlmaWVy
fSksdGhpcy5mZWF0dXJlcz17fSx0aGlzLmRlc2lyZWRGZWF0dXJlcz1uZXcgU2V0KHQuZmVhdHVy
ZXN8fFtdKSx0aGlzLmRlc2lyZWRGZWF0dXJlcy5hZGQodiksT2JqZWN0LmFzc2lnbih0aGlzLCgw
LHMuaikodGhpcy5hZ2VudElkZW50aWZpZXIsdCx0LmxvYWRlclR5cGV8fCJhZ2VudCIpKSx0aGlz
LnN0YXJ0KCkpOigwLGUuWikoIkZhaWxlZCB0byBpbml0aWFsIHRoZSBhZ2VudC4gQ291bGQgbm90
IGRldGVybWluZSB0aGUgcnVudGltZSBlbnZpcm9ubWVudC4iKX1nZXQgY29uZmlnKCl7cmV0dXJu
e2luZm86KDAsci5DNSkodGhpcy5hZ2VudElkZW50aWZpZXIpLGluaXQ6KDAsci5QXykodGhpcy5h
Z2VudElkZW50aWZpZXIpLGxvYWRlcl9jb25maWc6KDAsci5ETCkodGhpcy5hZ2VudElkZW50aWZp
ZXIpLHJ1bnRpbWU6KDAsci5PUCkodGhpcy5hZ2VudElkZW50aWZpZXIpfX1zdGFydCgpe2NvbnN0
IHQ9ImZlYXR1cmVzIjt0cnl7Y29uc3Qgcj1hKHRoaXMuYWdlbnRJZGVudGlmaWVyKSxpPVsuLi50
aGlzLmRlc2lyZWRGZWF0dXJlc107aS5zb3J0KCgoZSx0KT0+bi5wW2UuZmVhdHVyZU5hbWVdLW4u
cFt0LmZlYXR1cmVOYW1lXSkpLGkuZm9yRWFjaCgodD0+e2lmKHJbdC5mZWF0dXJlTmFtZV18fHQu
ZmVhdHVyZU5hbWU9PT1uLkQucGFnZVZpZXdFdmVudCl7Y29uc3QgaT1mdW5jdGlvbihlKXtzd2l0
Y2goZSl7Y2FzZSBuLkQuYWpheDpyZXR1cm5bbi5ELmpzZXJyb3JzXTtjYXNlIG4uRC5zZXNzaW9u
VHJhY2U6cmV0dXJuW24uRC5hamF4LG4uRC5wYWdlVmlld0V2ZW50XTtjYXNlIG4uRC5zZXNzaW9u
UmVwbGF5OnJldHVybltuLkQuc2Vzc2lvblRyYWNlXTtjYXNlIG4uRC5wYWdlVmlld1RpbWluZzpy
ZXR1cm5bbi5ELnBhZ2VWaWV3RXZlbnRdO2RlZmF1bHQ6cmV0dXJuW119fSh0LmZlYXR1cmVOYW1l
KTtpLmV2ZXJ5KChlPT5yW2VdKSl8fCgwLGUuWikoIiIuY29uY2F0KHQuZmVhdHVyZU5hbWUsIiBp
cyBlbmFibGVkIGJ1dCBvbmUgb3IgbW9yZSBkZXBlbmRlbnQgZmVhdHVyZXMgaGFzIGJlZW4gZGlz
YWJsZWQgKCIpLmNvbmNhdCgoMCxULlApKGkpLCIpLiBUaGlzIG1heSBjYXVzZSB1bmludGVuZGVk
IGNvbnNlcXVlbmNlcyBvciBtaXNzaW5nIGRhdGEuLi4iKSksdGhpcy5mZWF0dXJlc1t0LmZlYXR1
cmVOYW1lXT1uZXcgdCh0aGlzLmFnZW50SWRlbnRpZmllcix0aGlzLnNoYXJlZEFnZ3JlZ2F0b3Ip
fX0pKSwoMCxqLlF5KSh0aGlzLmFnZW50SWRlbnRpZmllcix0aGlzLmZlYXR1cmVzLHQpfWNhdGNo
KG4peygwLGUuWikoIkZhaWxlZCB0byBpbml0aWFsaXplIGFsbCBlbmFibGVkIGluc3RydW1lbnQg
Y2xhc3NlcyAoYWdlbnQgYWJvcnRlZCkgLSIsbik7Zm9yKGNvbnN0IGUgaW4gdGhpcy5mZWF0dXJl
cyl0aGlzLmZlYXR1cmVzW2VdLmFib3J0SGFuZGxlcj8uKCk7Y29uc3Qgcj0oMCxqLmZQKSgpO3Jl
dHVybiBkZWxldGUgci5pbml0aWFsaXplZEFnZW50c1t0aGlzLmFnZW50SWRlbnRpZmllcl0/LmFw
aSxkZWxldGUgci5pbml0aWFsaXplZEFnZW50c1t0aGlzLmFnZW50SWRlbnRpZmllcl0/Llt0XSxk
ZWxldGUgdGhpcy5zaGFyZWRBZ2dyZWdhdG9yLHIuZWU/LmFib3J0KCksZGVsZXRlIHIuZWU/Lmdl
dCh0aGlzLmFnZW50SWRlbnRpZmllciksITF9fWFkZFRvVHJhY2UodCl7KDAsZS5aKSgiQ2FsbCB0
byBhZ2VudCBhcGkgYWRkVG9UcmFjZSBmYWlsZWQuIFRoZSBwYWdlIGFjdGlvbiBmZWF0dXJlIGlz
IG5vdCBjdXJyZW50bHkgaW5pdGlhbGl6ZWQuIil9c2V0Q3VycmVudFJvdXRlTmFtZSh0KXsoMCxl
LlopKCJDYWxsIHRvIGFnZW50IGFwaSBzZXRDdXJyZW50Um91dGVOYW1lIGZhaWxlZC4gVGhlIHNw
YSBmZWF0dXJlIGlzIG5vdCBjdXJyZW50bHkgaW5pdGlhbGl6ZWQuIil9aW50ZXJhY3Rpb24oKXso
MCxlLlopKCJDYWxsIHRvIGFnZW50IGFwaSBpbnRlcmFjdGlvbiBmYWlsZWQuIFRoZSBzcGEgZmVh
dHVyZSBpcyBub3QgY3VycmVudGx5IGluaXRpYWxpemVkLiIpfX0oe2ZlYXR1cmVzOlt2LEMsTl0s
bG9hZGVyVHlwZToibGl0ZSJ9KX0pKCl9KSgpOzwvc2NyaXB0PjxtZXRhIGNvbnRlbnQ9Im5vaW5k
ZXgiIG5hbWU9InJvYm90cyIgLz48c2NyaXB0IHNyYz0iaHR0cHM6Ly9tYXBzLmdvb2dsZWFwaXMu
Y29tL21hcHMvYXBpL2pzP2tleT1BSXphU3lDMEJ1SjQzTmNibXVybzE3dlZ4V0pXck96ekFQWjBy
UUUmYW1wO2xpYnJhcmllcz1wbGFjZXMmYW1wO2xhbmd1YWdlPWVuIj48L3NjcmlwdD48bGluayBy
ZWw9InN0eWxlc2hlZXQiIG1lZGlhPSJzY3JlZW4iIGhyZWY9Ii9hc3NldHMvYXBwbGljYXRpb24t
Y2VlODVkZTY5NzkyNjQ2OTBiNmQxZWU0YjIzZmY0YmQ3OWJjNDllODlkOWU0YTI0YTFhYTg0MDcz
MDlmMjU3NS5jc3MiIC8+PGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBtZWRpYT0ic2NyZWVuIiBocmVm
PSIvcGFja3MvY3NzLzI3ODQtNjlkNDRiODUuY3NzIiAvPgo8bGluayByZWw9InN0eWxlc2hlZXQi
IG1lZGlhPSJzY3JlZW4iIGhyZWY9Ii9wYWNrcy9jc3MvNDEwNC03ZDVmMzIzMS5jc3MiIC8+Cjxs
aW5rIHJlbD0ic3R5bGVzaGVldCIgbWVkaWE9InNjcmVlbiIgaHJlZj0iL3BhY2tzL2Nzcy84NTY0
LTY2MDZhMDZjLmNzcyIgLz4KPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBtZWRpYT0ic2NyZWVuIiBo
cmVmPSIvcGFja3MvY3NzLzMwMzQtYTVhMWE5M2IuY3NzIiAvPgo8bGluayByZWw9InN0eWxlc2hl
ZXQiIG1lZGlhPSJzY3JlZW4iIGhyZWY9Ii9wYWNrcy9jc3MvMTUyOS02NTNjYzQwNy5jc3MiIC8+
CjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgbWVkaWE9InNjcmVlbiIgaHJlZj0iL3BhY2tzL2Nzcy80
NDYyLTRmMDgxYTNkLmNzcyIgLz4KPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBtZWRpYT0ic2NyZWVu
IiBocmVmPSIvcGFja3MvY3NzLzM1MzQtMDY3Yjc3ZDUuY3NzIiAvPgo8bGluayByZWw9InN0eWxl
c2hlZXQiIG1lZGlhPSJzY3JlZW4iIGhyZWY9Ii9wYWNrcy9jc3MvYXBwbGljYXRpb24tYmM4ZTY1
YjAuY3NzIiAvPjxsaW5rIHJlbD0ic3R5bGVzaGVldCIgbWVkaWE9InNjcmVlbiIgaHJlZj0iL3Bh
Y2tzL2Nzcy8xNTI5LTY1M2NjNDA3LmNzcyIgLz4KPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBtZWRp
YT0ic2NyZWVuIiBocmVmPSIvcGFja3MvY3NzL3RhaWx3aW5kLWM4NTczNDQ2LmNzcyIgLz48c2Ny
aXB0IHNyYz0iL3BhY2tzL2pzL3J1bnRpbWUtYzVkMmIyYjgzNTllZWI3NTMxMTEuanMiPjwvc2Ny
aXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzE3NjEtNjg5YTNiOWZkMWQ3ZjYxYTY2MDIuanMi
Pjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzY4NDktMmM3YzljNWM3ODIwOWNhODUw
NmIuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzg0NjEtN2MwNDJmYzdkMzBi
OThjNzgwYTEuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzk5NjUtZTgzZWU5
YWM2MDlhNjZjZjFiNDcuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzUxOTYt
MGQyYWU5NjI0MzQ2OGFlZGFhMzMuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pz
LzQyNzUtOWYxNmQ3ZDIxZjg0NzgwM2QxZmYuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3Bh
Y2tzL2pzLzk5MDctYjVmYzE0NThkNWY2MTllNGFmOTcuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNy
Yz0iL3BhY2tzL2pzLzc3OTItMGNlZmM4NmFkYThlMjZjODc3MTQuanMiPjwvc2NyaXB0Pgo8c2Ny
aXB0IHNyYz0iL3BhY2tzL2pzLzIxODctNmU4NzNkNmE4MGQ4MjJkZDg3ZTguanMiPjwvc2NyaXB0
Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzk1MDQtM2Y2YzBhMzljYmMyNTU5ZTIxYjcuanMiPjwv
c2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzMyNjEtZGEyZTgzMjg1MTgyODY5YWFjNzku
anMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzM1NDAtMGIxOGE2ZmM3NmU5Mjk3
ZmM3YTEuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzc0OTQtMTJkMDE1NGM4
MWI5MzMwMzZhMTYuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzUyNzYtNTYy
ZTk1M2FlOGYzNjZhZGRkZDcuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzEz
NDktOGRkYThlNDdhYmNjOGU2NzEyYjkuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tz
L2pzLzEzODMtM2UyZTg5OGZhODAwYTdjMjFhMzAuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0i
L3BhY2tzL2pzLzk4NzMtYzZjODhjNDM5MGZlMDg5YWM1ZDQuanMiPjwvc2NyaXB0Pgo8c2NyaXB0
IHNyYz0iL3BhY2tzL2pzLzI3ODQtODcwZjFjNzAxYjRkZTM5MjI5ODQuanMiPjwvc2NyaXB0Pgo8
c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzU2NDMtYTI2OTYyYTdmYWZlYzk0ODIwNWYuanMiPjwvc2Ny
aXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pzLzUyNS1jYzJmZTUxNWQ1OTZmNTg4MDU2Yi5qcyI+
PC9zY3JpcHQ+CjxzY3JpcHQgc3JjPSIvcGFja3MvanMvNDgwNy03YWY5NzRjN2E2ZmU5MmRlOTUw
Mi5qcyI+PC9zY3JpcHQ+CjxzY3JpcHQgc3JjPSIvcGFja3MvanMvNDEwNC1iYTNiN2ZkOTM2MjI0
YmE5YTNlMS5qcyI+PC9zY3JpcHQ+CjxzY3JpcHQgc3JjPSIvcGFja3MvanMvMzE4LWQ0Y2M4ZjYx
OGU0MDc3NGQyZmZjLmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy80MjY0LWEy
MjQ5OTRmNmZmNDNlNWExMjQ0LmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy84
NTY0LTYxODQyMzFlNmZhOTg2ZDU5NGFlLmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNr
cy9qcy8yMTAyLTkwZTUwZTg3ZDUxZWI2NTA0MDQ1LmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9
Ii9wYWNrcy9qcy8zMTk0LTU1MjNjODQxMzI3NmIyMGM4NWFiLmpzIj48L3NjcmlwdD4KPHNjcmlw
dCBzcmM9Ii9wYWNrcy9qcy8xMDc1LWM4NmM0OWIwMDZkYjVhNzFmM2RiLmpzIj48L3NjcmlwdD4K
PHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy8xNzczLWEwZThhNzIxMGY1M2U0ZmQ2YzU2LmpzIj48L3Nj
cmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy83NTc1LTNiMzQ5OGY2NTlmNDE1ZmU4OGZjLmpz
Ij48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy8zMDM0LTI5OGQ0MzFkYTY1NGZiNjhi
ZDMyLmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy84OTUyLWVhMGY2Y2ZmYzU0
ZDZjM2ZmZTE2LmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy80NDYyLTk3M2Zm
MDA5NWE3YzE0YjA2OTdhLmpzIj48L3NjcmlwdD4KPHNjcmlwdCBzcmM9Ii9wYWNrcy9qcy8yOTgt
OTFmYzk2YjQ0ODA5ZDcwYTllMDcuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3BhY2tzL2pz
LzM1MzQtMDgyZTYzYmE4ZjBmYjZmM2YyNTQuanMiPjwvc2NyaXB0Pgo8c2NyaXB0IHNyYz0iL3Bh
Y2tzL2pzL2FwcGxpY2F0aW9uLWI1MzU0ZjYxYWJjOWYxNDVhMjE4LmpzIj48L3NjcmlwdD48c2Ny
aXB0IHNyYz0iL2Fzc2V0cy9hcHBsaWNhdGlvbi0yY2Q0ZWQ0ODc3OTEzMTgxOWIxZGU3NTBjODEx
ZjJiMzE0ODJlYzFhMDg4ZTA0ZDUyNTlkYzAwNWQzNjU4MmNkLmpzIj48L3NjcmlwdD48bWV0YSBu
YW1lPSJjc3JmLXBhcmFtIiBjb250ZW50PSJhdXRoZW50aWNpdHlfdG9rZW4iIC8+CjxtZXRhIG5h
bWU9ImNzcmYtdG9rZW4iIGNvbnRlbnQ9IllSVHZwZXpsdE5NeWFyb1JHREFoZGctb1Y1MHZiRnZF
Y0RYczlTOHNnWnFuTlpidGJ3Nkl0azB4X3Z1ODAwdTFEUUpPYXVURk50a29YSmFZdXNrWThRIiAv
PjwvaGVhZD48Ym9keSBjbGFzcz0iaG9tZSBpbmRleCI+PGRpdiBpZD0iU2VhcmNoLXJlYWN0LWNv
bXBvbmVudC0zYzQxMTRhMy01OTUxLTRjNGYtOThmZi1kYmNlN2RiYmM1N2MiPjwvZGl2PgogICAg
ICA8c2NyaXB0IHR5cGU9ImFwcGxpY2F0aW9uL2pzb24iIGNsYXNzPSJqcy1yZWFjdC1vbi1yYWls
cy1jb21wb25lbnQiIGRhdGEtY29tcG9uZW50LW5hbWU9IlNlYXJjaCIgZGF0YS1kb20taWQ9IlNl
YXJjaC1yZWFjdC1jb21wb25lbnQtM2M0MTE0YTMtNTk1MS00YzRmLTk4ZmYtZGJjZTdkYmJjNTdj
Ij57IndhYXMiOmZhbHNlLCJzaXRlTmF2Ijp7ImxlZnQiOlt7Im5hbWUiOiJDb21tdW5pdHkiLCJp
Y29uIjoiaW9uLW1kLXBlb3BsZSIsImJhZGdlX2NvbnRlbnQiOm51bGwsImVudHJpZXMiOlt7Im5h
bWUiOiJGb3J1bSIsImljb24iOiJpb24tbWQtY2hhdGJveGVzIiwicGF0aCI6Ii9jaGFubmVscy9h
bGwifSx7Im5hbWUiOiJDb21wYW55IERpcmVjdG9yeSIsImljb24iOiJpb24tbWQtYnJpZWZjYXNl
IiwicGF0aCI6Ii9kaXJlY3RvcnkifSx7Im5hbWUiOiJGb3VuZGVyIERpcmVjdG9yeSIsImljb24i
OiJpb24tbWQtY29udGFjdHMiLCJwYXRoIjoiL2RpcmVjdG9yeS9mb3VuZGVycyJ9LHsibmFtZSI6
IllDIE5ldHdvcmsgTmF2aWdhdG9yIiwiaWNvbiI6Imlvbi1tZC1jb21wYXNzIiwicGF0aCI6Ii9u
YXZpZ2F0b3IifSx7Im5hbWUiOiJCYXRjaCBXMjAyMSIsImljb24iOiJpb24taW9zLXBlb3BsZSIs
InBhdGgiOiIvYmF0Y2hlcy93MjAyMSJ9LHsibmFtZSI6Ikdyb3VwIDMiLCJpY29uIjoiaW9uLWlv
cy1yZXR1cm4tcmlnaHQiLCJwYXRoIjoiL2JhdGNoZXMvdzIwMjEjZ3JvdXAtMyJ9LHsibmFtZSI6
IkFsdW1uaSBEZW1vIERheSIsImljb24iOiJpb24tbWQtYm9uZmlyZSIsInBhdGgiOiIvZGlyZWN0
b3J5L2RlbW9fZGF5In0seyJuYW1lIjoiTGF1bmNoIFlDIiwiaWNvbiI6Imlvbi1pb3MtbWVnYXBo
b25lIiwicGF0aCI6Imh0dHBzOi8vd3d3Lnljb21iaW5hdG9yLmNvbS9sYXVuY2hlcyJ9LHsibmFt
ZSI6IllDIFRvcCBDb21wYW5pZXMgYnkgUmV2ZW51ZSIsImljb24iOiJpb24tbG9nby11c2QiLCJw
YXRoIjoiaHR0cHM6Ly93d3cueWNvbWJpbmF0b3IuY29tL3RvcGNvbXBhbmllcy9yZXZlbnVlIn0s
eyJuYW1lIjoiWUMgVG9wIENvbXBhbmllcyBieSBWYWx1YXRpb24iLCJpY29uIjoiaW9uLWlvcy10
cmVuZGluZy11cC1vdXRsaW5lIiwicGF0aCI6Imh0dHBzOi8vd3d3Lnljb21iaW5hdG9yLmNvbS90
b3Bjb21wYW5pZXMvdmFsdWF0aW9uIn0seyJuYW1lIjoiWUMgU3RvcmUiLCJpY29uIjoiaW9uLWlv
cy1zaGlydCIsInBhdGgiOiJodHRwczovL3Nob3AuZ2Vtbm90ZS5jb20veWMvc2hvcCJ9LHsibmFt
ZSI6IllDIFByaW50IFNob3AiLCJpY29uIjoiaW9uLWlvcy1lYXNlbCIsInBhdGgiOiJodHRwczov
L3d3dy5sZXZlbGZyYW1lcy5jb20vZGlyZWN0b3J5L3ktY29tYmluYXRvci1wcmludC1zaG9wIn0s
eyJuYW1lIjoiQWx1bW5pIEdyb3VwcyIsImljb24iOiJpb24taW9zLWNoYXRidWJibGVzLW91dGxp
bmUiLCJwYXRoIjoiL2tub3dsZWRnZS85bS1vbmxpbmUtYWx1bW5pLWdyb3VwcyJ9LHsibmFtZSI6
IlRoaXMgd2VlayBhdCBZQyIsImljb24iOiJpb24taW9zLWluZm9ybWF0aW9uLWNpcmNsZS1vdXRs
aW5lIiwicGF0aCI6Imh0dHBzOi8vdXM3LmNhbXBhaWduLWFyY2hpdmUuY29tL2hvbWUvP3U9NjUw
N2JmNGU0YzJkZjNmZGJhZTZlZjczOFx1MDAyNmlkPTU0NzcyNTA0OWIifV19LHsibmFtZSI6IlJl
c291cmNlcyIsImljb24iOiJpb24taW9zLWJvb2siLCJlbnRyaWVzIjpbeyJuYW1lIjoiVXNlciBN
YW51YWwiLCJpY29uIjoiaW9uLWlvcy1ib29rbWFya3Mtb3V0bGluZSIsInBhdGgiOiIva25vd2xl
ZGdlLzFULXljLXVzZXItbWFudWFsIn0seyJuYW1lIjoiQmF0Y2ggU2NoZWR1bGUiLCJpY29uIjoi
aW9uLW1kLWNhbGVuZGFyIiwicGF0aCI6Ii9zY2hlZHVsZSJ9LHsibmFtZSI6IkRlYWxzIiwiaWNv
biI6Imlvbi1tZC1jYXJkIiwicGF0aCI6Ii9kZWFscyJ9LHsibmFtZSI6IlByb2Zlc3Npb25hbCBT
ZXJ2aWNlcyBEaXJlY3RvcnkiLCJpY29uIjoiaW9uLW1kLXBlb3BsZSIsInBhdGgiOiIvcHJvZmVz
c2lvbmFsX3NlcnZpY2VzIn0seyJuYW1lIjoiRnVuZHJhaXNpbmcgVHJlbmRzIiwiaWNvbiI6Imlv
bi1pb3Mtc3RhdHMiLCJwYXRoIjoiL3RyZW5kcyJ9LHsibmFtZSI6IkludmVzdG9yIERhdGFiYXNl
IiwiaWNvbiI6Imlvbi1sb2dvLXVzZCIsInBhdGgiOiIvZGlyZWN0b3J5L2ludmVzdG9ycz95ZWFy
PSU1QjIwMTklMkMrMjAyMyU1RCJ9LHsibmFtZSI6IlN0YXJ0dXAgTGlicmFyeSIsImljb24iOiJp
b24taW9zLWJvb2stb3V0bGluZSIsInBhdGgiOiJodHRwczovL3ljb21iaW5hdG9yLmNvbS9saWJy
YXJ5In0seyJuYW1lIjoiU2VyaWVzIEEgTWFudWFsIiwiaWNvbiI6Imlvbi1pb3MtY29tcGFzcyIs
InBhdGgiOiIva25vd2xlZGdlL0ZJLXNlcmllcy1hLW1hbnVhbCJ9LHsibmFtZSI6IkJvb2tmYWNl
IENvbXBhbmlvbiIsImljb24iOiJpb24tbG9nby1jaHJvbWUiLCJwYXRoIjoiL2tub3dsZWRnZS9F
bS1ib29rZmFjZS1jb21wYW5pb24ifSx7Im5hbWUiOiJNeSBMaXN0cyIsImljb24iOiJpb24taW9z
LWxpc3QtYm94LW91dGxpbmUiLCJwYXRoIjoiL2xpc3RzIn1dfSx7Im5hbWUiOiJDb250YWN0IFlD
IiwiaWNvbiI6Imlvbi1sb2dvLWhhY2tlcm5ld3MiLCJlbnRyaWVzIjpbeyJuYW1lIjoiQm9vayBP
ZmZpY2UgSG91cnMiLCJpY29uIjoiaW9uLW1kLWJvb2ttYXJrcyIsInBhdGgiOiIvYm9va2VyIn0s
eyJuYW1lIjoiRmluYW5jaW5ncyBcdTAwMjYgVHJhbnNhY3Rpb25zIiwiaWNvbiI6Imlvbi1tZC1j
YXNoIiwicGF0aCI6Ii9rbm93bGVkZ2UvQnAtbm90aWZ5LXljLWZpbmFuY2luZ3MtdHJhbnNhY3Rp
b25zIn0seyJuYW1lIjoiUGVvcGxlIGF0IFlDIiwiaWNvbiI6Imlvbi1tZC1wZW9wbGUiLCJwYXRo
IjoiL3ljIn0seyJuYW1lIjoiUmVwb3J0IEJhZCBBY3RvcnMiLCJpY29uIjoiaW9uLW1kLXNhZCIs
InBhdGgiOiJodHRwczovL2RvY3MuZ29vZ2xlLmNvbS9mb3Jtcy9kL2UvMUZBSXBRTFNmMUJUXzI4
VkZLUVMtQVFtOVhLQTIzOC1vMldCVDkwVW0zUG5EMHhTZzVVQngtWFEvdmlld2Zvcm0ifSx7Im5h
bWUiOiJSZWNvbW1lbmQgU3RhcnR1cHMiLCJpY29uIjoiaW9uLW1kLXBlcnNvbi1hZGQiLCJwYXRo
IjoiaHR0cHM6Ly9hcHBseS55Y29tYmluYXRvci5jb20vcmVjb21tZW5kYXRpb25zIn0seyJuYW1l
IjoiRW1haWwgVXMiLCJpY29uIjoiaW9uLWlvcy1tYWlsIiwicGF0aCI6Im1haWx0bzpib29rZmFj
ZUB5Y29tYmluYXRvci5jb20ifV19LHsibmFtZSI6IlJlY3J1aXRpbmciLCJpY29uIjoiaW9uLW1k
LXBlcnNvbi1hZGQiLCJlbnRyaWVzIjpbeyJuYW1lIjoiRGFzaGJvYXJkIiwiaWNvbiI6Imlvbi1p
b3MtaG9tZSIsInBhdGgiOiIvd29ya2F0YXN0YXJ0dXAvZGFzaGJvYXJkIn0seyJuYW1lIjoiU291
cmNlIiwiaWNvbiI6Imlvbi1pb3MtY29udGFjdHMiLCJwYXRoIjoiL3dvcmthdGFzdGFydHVwL2Fw
cGxpY2FudHMifSx7Im5hbWUiOiJJbmJveCIsImljb24iOiJpb24taW9zLW1haWwiLCJwYXRoIjoi
L3dvcmthdGFzdGFydHVwL2luYm94Iiwid2Fhc191bnJlYWRfaW5ib3giOnRydWV9LHsibmFtZSI6
IkFwcGxpY2FudHMiLCJpY29uIjoiaW9uLWlvcy1oYW5kIiwicGF0aCI6Ii93b3JrYXRhc3RhcnR1
cC9hcHBsaWVkIiwid2Fhc191bnJlYWRfYXBwbGllZCI6dHJ1ZX0seyJuYW1lIjoiSm9icyIsImlj
b24iOiJpb24tbWQtZG9jdW1lbnQiLCJwYXRoIjoiL2NvbXBhbnkvMjMxMDUvam9icyIsImJhZGdl
X2NvbnRlbnQiOm51bGx9XSwid2Fhc191bnJlYWRfaW5ib3giOnRydWV9LHsibmFtZSI6IkNvbXBh
bnkiLCJpY29uIjoiaW9uLW1kLWJyaWVmY2FzZSIsImVudHJpZXMiOlt7Im5hbWUiOiJRdWVzdGJv
b2siLCJpY29uIjoiaW9uLW1kLWJyaWVmY2FzZSIsInBhdGgiOiIvY29tcGFueS8yMzEwNSJ9LHsi
bmFtZSI6IkludmVzdG1lbnRzIiwiaWNvbiI6Imlvbi1pb3MtcmV0dXJuLXJpZ2h0IiwicGF0aCI6
Ii9jb21wYW55LzIzMTA1L2ludmVzdG1lbnRzIn0seyJuYW1lIjoiRGVtbyBEYXkgTGVhZHMiLCJp
Y29uIjoiaW9uLWlvcy1yZXR1cm4tcmlnaHQiLCJwYXRoIjoiL2NvbXBhbnkvMjMxMDUvZGVtb19k
YXlfaW52ZXN0b3JzIn0seyJuYW1lIjoiUmF0ZSB5b3VyIGludmVzdG9ycyIsImljb24iOiJpb24t
aW9zLXJldHVybi1yaWdodCIsInBhdGgiOiIvaW52ZXN0b3JfZ3JhZGVzIn0seyJuYW1lIjoiSW52
ZXN0b3IgVXBkYXRlcyIsImljb24iOiJpb24taW9zLXJldHVybi1yaWdodCIsInBhdGgiOiIvY29t
cGFuaWVzLzIzMTU1L2NvbXBhbnlfdXBkYXRlcyJ9XX1dLCJyaWdodCI6W3sibmFtZSI6Ik1hZGhh
dmFuIiwiaWNvbiI6Imlvbi1tZC1jb250YWN0IiwidHlwZSI6InVzZXIiLCJlbnRyaWVzIjpbeyJu
YW1lIjoiTXkgUHJvZmlsZSIsImljb24iOiJpb24tbWQtY29udGFjdCIsInBhdGgiOiIvdXNlci8x
ODI4NTMifSx7Im5hbWUiOiJGb3J1bSBOb3RpZmljYXRpb25zIiwiaWNvbiI6Imlvbi1tZC1ub3Rp
ZmljYXRpb25zIiwicGF0aCI6Ii9mb3J1bS9ub3RpZmljYXRpb25zIn0seyJuYW1lIjoiRm9ydW0g
S2V5d29yZCBBbGVydHMiLCJpY29uIjoiaW9uLW1kLWhlYWRzZXQiLCJwYXRoIjoiL2ZvcnVtX2Fs
ZXJ0cyJ9LHsibmFtZSI6IkxvZyBPdXQiLCJpY29uIjoiaW9uLW1kLWxvZy1vdXQiLCJwYXRoIjoi
L3Nlc3Npb24vbG9nb3V0In1dfV19LCJkZWZhdWx0UXVlcnkiOm51bGwsIm9wZW5LZXkiOiJrIn08
L3NjcmlwdD4KICAgICAgCjxtZXRhIGNvbnRlbnQ9Im5vZm9sbG93IiBuYW1lPSJyb2JvdHMiIC8+
PHNjcmlwdCB0eXBlPSJhcHBsaWNhdGlvbi9qc29uIiBpZD0ianMtcmVhY3Qtb24tcmFpbHMtY29u
dGV4dCI+eyJyYWlsc0VudiI6InByb2R1Y3Rpb24iLCJpbk1haWxlciI6ZmFsc2UsImkxOG5Mb2Nh
bGUiOiJlbiIsImkxOG5EZWZhdWx0TG9jYWxlIjoiZW4iLCJyb3JWZXJzaW9uIjoiMTMuMC4wIiwi
cm9yUHJvIjpmYWxzZSwiaHJlZiI6Imh0dHBzOi8vYm9va2ZhY2UueWNvbWJpbmF0b3IuY29tL2hv
bWUiLCJsb2NhdGlvbiI6Ii9ob21lIiwic2NoZW1lIjoiaHR0cHMiLCJob3N0IjoiYm9va2ZhY2Uu
eWNvbWJpbmF0b3IuY29tIiwicG9ydCI6bnVsbCwicGF0aG5hbWUiOiIvaG9tZSIsInNlYXJjaCI6
bnVsbCwiaHR0cEFjY2VwdExhbmd1YWdlIjpudWxsLCJhcHBseUJhdGNoTG9uZyI6IldpbnRlciAy
MDI0IiwiYXBwbHlCYXRjaFNob3J0IjoiVzIwMjQiLCJhcHBseURlYWRsaW5lU2hvcnQiOiJPY3Rv
YmVyIDEzIiwieWNkY1JldHJvTW9kZSI6ZmFsc2UsImN1cnJlbnRVc2VyIjp7ImlkIjoxODI4NTMs
ImFkbWluIjpmYWxzZSwid2Fhc19hZG1pbiI6ZmFsc2UsInljX3BhcnRuZXIiOmZhbHNlLCJjdXJy
ZW50X2NvbXBhbnkiOnsibmFtZSI6IlF1ZXN0Ym9vayJ9LCJjb21wYW55X2Zvcl9kZWFscyI6eyJu
YW1lIjoiUXVlc3Rib29rIn0sImZ1bGxfbmFtZSI6Ik1hZGhhdmFuIE1hbG9sYW4iLCJmaXJzdF9u
YW1lIjoiTWFkaGF2YW4iLCJobmlkIjoibWFkaGF2YW5tYWxvbGFuIn0sInNlcnZlclNpZGUiOmZh
bHNlfTwvc2NyaXB0Pgo8ZGl2IGlkPSJCb29rZmFjZUNzckFwcC1yZWFjdC1jb21wb25lbnQtMjlm
ZGRhYWItZTZkOS00YWQ5LTgzZDgtOGU1NTJmOWY0Y2U3Ij48L2Rpdj4KICAgICAgPHNjcmlwdCB0
eXBlPSJhcHBsaWNhdGlvbi9qc29uIiBjbGFzcz0ianMtcmVhY3Qtb24tcmFpbHMtY29tcG9uZW50
IiBkYXRhLWNvbXBvbmVudC1uYW1lPSJCb29rZmFjZUNzckFwcCIgZGF0YS1kb20taWQ9IkJvb2tm
YWNlQ3NyQXBwLXJlYWN0LWNvbXBvbmVudC0yOWZkZGFhYi1lNmQ5LTRhZDktODNkOC04ZTU1MmY5
ZjRjZTciPnsibmF2TWVudXMiOnsibGVmdCI6W3sibmFtZSI6IkNvbW11bml0eSIsImljb24iOiJp
b24tbWQtcGVvcGxlIiwiYmFkZ2VfY29udGVudCI6bnVsbCwiZW50cmllcyI6W3sibmFtZSI6IkZv
cnVtIiwiaWNvbiI6Imlvbi1tZC1jaGF0Ym94ZXMiLCJwYXRoIjoiL2NoYW5uZWxzL2FsbCJ9LHsi
bmFtZSI6IkNvbXBhbnkgRGlyZWN0b3J5IiwiaWNvbiI6Imlvbi1tZC1icmllZmNhc2UiLCJwYXRo
IjoiL2RpcmVjdG9yeSJ9LHsibmFtZSI6IkZvdW5kZXIgRGlyZWN0b3J5IiwiaWNvbiI6Imlvbi1t
ZC1jb250YWN0cyIsInBhdGgiOiIvZGlyZWN0b3J5L2ZvdW5kZXJzIn0seyJuYW1lIjoiWUMgTmV0
d29yayBOYXZpZ2F0b3IiLCJpY29uIjoiaW9uLW1kLWNvbXBhc3MiLCJwYXRoIjoiL25hdmlnYXRv
ciJ9LHsibmFtZSI6IkJhdGNoIFcyMDIxIiwiaWNvbiI6Imlvbi1pb3MtcGVvcGxlIiwicGF0aCI6
Ii9iYXRjaGVzL3cyMDIxIn0seyJuYW1lIjoiR3JvdXAgMyIsImljb24iOiJpb24taW9zLXJldHVy
bi1yaWdodCIsInBhdGgiOiIvYmF0Y2hlcy93MjAyMSNncm91cC0zIn0seyJuYW1lIjoiQWx1bW5p
IERlbW8gRGF5IiwiaWNvbiI6Imlvbi1tZC1ib25maXJlIiwicGF0aCI6Ii9kaXJlY3RvcnkvZGVt
b19kYXkifSx7Im5hbWUiOiJMYXVuY2ggWUMiLCJpY29uIjoiaW9uLWlvcy1tZWdhcGhvbmUiLCJw
YXRoIjoiaHR0cHM6Ly93d3cueWNvbWJpbmF0b3IuY29tL2xhdW5jaGVzIn0seyJuYW1lIjoiWUMg
VG9wIENvbXBhbmllcyBieSBSZXZlbnVlIiwiaWNvbiI6Imlvbi1sb2dvLXVzZCIsInBhdGgiOiJo
dHRwczovL3d3dy55Y29tYmluYXRvci5jb20vdG9wY29tcGFuaWVzL3JldmVudWUifSx7Im5hbWUi
OiJZQyBUb3AgQ29tcGFuaWVzIGJ5IFZhbHVhdGlvbiIsImljb24iOiJpb24taW9zLXRyZW5kaW5n
LXVwLW91dGxpbmUiLCJwYXRoIjoiaHR0cHM6Ly93d3cueWNvbWJpbmF0b3IuY29tL3RvcGNvbXBh
bmllcy92YWx1YXRpb24ifSx7Im5hbWUiOiJZQyBTdG9yZSIsImljb24iOiJpb24taW9zLXNoaXJ0
IiwicGF0aCI6Imh0dHBzOi8vc2hvcC5nZW1ub3RlLmNvbS95Yy9zaG9wIn0seyJuYW1lIjoiWUMg
UHJpbnQgU2hvcCIsImljb24iOiJpb24taW9zLWVhc2VsIiwicGF0aCI6Imh0dHBzOi8vd3d3Lmxl
dmVsZnJhbWVzLmNvbS9kaXJlY3RvcnkveS1jb21iaW5hdG9yLXByaW50LXNob3AifSx7Im5hbWUi
OiJBbHVtbmkgR3JvdXBzIiwiaWNvbiI6Imlvbi1pb3MtY2hhdGJ1YmJsZXMtb3V0bGluZSIsInBh
dGgiOiIva25vd2xlZGdlLzltLW9ubGluZS1hbHVtbmktZ3JvdXBzIn0seyJuYW1lIjoiVGhpcyB3
ZWVrIGF0IFlDIiwiaWNvbiI6Imlvbi1pb3MtaW5mb3JtYXRpb24tY2lyY2xlLW91dGxpbmUiLCJw
YXRoIjoiaHR0cHM6Ly91czcuY2FtcGFpZ24tYXJjaGl2ZS5jb20vaG9tZS8/dT02NTA3YmY0ZTRj
MmRmM2ZkYmFlNmVmNzM4XHUwMDI2aWQ9NTQ3NzI1MDQ5YiJ9XX0seyJuYW1lIjoiUmVzb3VyY2Vz
IiwiaWNvbiI6Imlvbi1pb3MtYm9vayIsImVudHJpZXMiOlt7Im5hbWUiOiJVc2VyIE1hbnVhbCIs
Imljb24iOiJpb24taW9zLWJvb2ttYXJrcy1vdXRsaW5lIiwicGF0aCI6Ii9rbm93bGVkZ2UvMVQt
eWMtdXNlci1tYW51YWwifSx7Im5hbWUiOiJCYXRjaCBTY2hlZHVsZSIsImljb24iOiJpb24tbWQt
Y2FsZW5kYXIiLCJwYXRoIjoiL3NjaGVkdWxlIn0seyJuYW1lIjoiRGVhbHMiLCJpY29uIjoiaW9u
LW1kLWNhcmQiLCJwYXRoIjoiL2RlYWxzIn0seyJuYW1lIjoiUHJvZmVzc2lvbmFsIFNlcnZpY2Vz
IERpcmVjdG9yeSIsImljb24iOiJpb24tbWQtcGVvcGxlIiwicGF0aCI6Ii9wcm9mZXNzaW9uYWxf
c2VydmljZXMifSx7Im5hbWUiOiJGdW5kcmFpc2luZyBUcmVuZHMiLCJpY29uIjoiaW9uLWlvcy1z
dGF0cyIsInBhdGgiOiIvdHJlbmRzIn0seyJuYW1lIjoiSW52ZXN0b3IgRGF0YWJhc2UiLCJpY29u
IjoiaW9uLWxvZ28tdXNkIiwicGF0aCI6Ii9kaXJlY3RvcnkvaW52ZXN0b3JzP3llYXI9JTVCMjAx
OSUyQysyMDIzJTVEIn0seyJuYW1lIjoiU3RhcnR1cCBMaWJyYXJ5IiwiaWNvbiI6Imlvbi1pb3Mt
Ym9vay1vdXRsaW5lIiwicGF0aCI6Imh0dHBzOi8veWNvbWJpbmF0b3IuY29tL2xpYnJhcnkifSx7
Im5hbWUiOiJTZXJpZXMgQSBNYW51YWwiLCJpY29uIjoiaW9uLWlvcy1jb21wYXNzIiwicGF0aCI6
Ii9rbm93bGVkZ2UvRkktc2VyaWVzLWEtbWFudWFsIn0seyJuYW1lIjoiQm9va2ZhY2UgQ29tcGFu
aW9uIiwiaWNvbiI6Imlvbi1sb2dvLWNocm9tZSIsInBhdGgiOiIva25vd2xlZGdlL0VtLWJvb2tm
YWNlLWNvbXBhbmlvbiJ9LHsibmFtZSI6Ik15IExpc3RzIiwiaWNvbiI6Imlvbi1pb3MtbGlzdC1i
b3gtb3V0bGluZSIsInBhdGgiOiIvbGlzdHMifV19LHsibmFtZSI6IkNvbnRhY3QgWUMiLCJpY29u
IjoiaW9uLWxvZ28taGFja2VybmV3cyIsImVudHJpZXMiOlt7Im5hbWUiOiJCb29rIE9mZmljZSBI
b3VycyIsImljb24iOiJpb24tbWQtYm9va21hcmtzIiwicGF0aCI6Ii9ib29rZXIifSx7Im5hbWUi
OiJGaW5hbmNpbmdzIFx1MDAyNiBUcmFuc2FjdGlvbnMiLCJpY29uIjoiaW9uLW1kLWNhc2giLCJw
YXRoIjoiL2tub3dsZWRnZS9CcC1ub3RpZnkteWMtZmluYW5jaW5ncy10cmFuc2FjdGlvbnMifSx7
Im5hbWUiOiJQZW9wbGUgYXQgWUMiLCJpY29uIjoiaW9uLW1kLXBlb3BsZSIsInBhdGgiOiIveWMi
fSx7Im5hbWUiOiJSZXBvcnQgQmFkIEFjdG9ycyIsImljb24iOiJpb24tbWQtc2FkIiwicGF0aCI6
Imh0dHBzOi8vZG9jcy5nb29nbGUuY29tL2Zvcm1zL2QvZS8xRkFJcFFMU2YxQlRfMjhWRktRUy1B
UW05WEtBMjM4LW8yV0JUOTBVbTNQbkQweFNnNVVCeC1YUS92aWV3Zm9ybSJ9LHsibmFtZSI6IlJl
Y29tbWVuZCBTdGFydHVwcyIsImljb24iOiJpb24tbWQtcGVyc29uLWFkZCIsInBhdGgiOiJodHRw
czovL2FwcGx5Lnljb21iaW5hdG9yLmNvbS9yZWNvbW1lbmRhdGlvbnMifSx7Im5hbWUiOiJFbWFp
bCBVcyIsImljb24iOiJpb24taW9zLW1haWwiLCJwYXRoIjoibWFpbHRvOmJvb2tmYWNlQHljb21i
aW5hdG9yLmNvbSJ9XX0seyJuYW1lIjoiUmVjcnVpdGluZyIsImljb24iOiJpb24tbWQtcGVyc29u
LWFkZCIsImVudHJpZXMiOlt7Im5hbWUiOiJEYXNoYm9hcmQiLCJpY29uIjoiaW9uLWlvcy1ob21l
IiwicGF0aCI6Ii93b3JrYXRhc3RhcnR1cC9kYXNoYm9hcmQifSx7Im5hbWUiOiJTb3VyY2UiLCJp
Y29uIjoiaW9uLWlvcy1jb250YWN0cyIsInBhdGgiOiIvd29ya2F0YXN0YXJ0dXAvYXBwbGljYW50
cyJ9LHsibmFtZSI6IkluYm94IiwiaWNvbiI6Imlvbi1pb3MtbWFpbCIsInBhdGgiOiIvd29ya2F0
YXN0YXJ0dXAvaW5ib3giLCJ3YWFzX3VucmVhZF9pbmJveCI6dHJ1ZX0seyJuYW1lIjoiQXBwbGlj
YW50cyIsImljb24iOiJpb24taW9zLWhhbmQiLCJwYXRoIjoiL3dvcmthdGFzdGFydHVwL2FwcGxp
ZWQiLCJ3YWFzX3VucmVhZF9hcHBsaWVkIjp0cnVlfSx7Im5hbWUiOiJKb2JzIiwiaWNvbiI6Imlv
bi1tZC1kb2N1bWVudCIsInBhdGgiOiIvY29tcGFueS8yMzEwNS9qb2JzIiwiYmFkZ2VfY29udGVu
dCI6bnVsbH1dLCJ3YWFzX3VucmVhZF9pbmJveCI6dHJ1ZX0seyJuYW1lIjoiQ29tcGFueSIsImlj
b24iOiJpb24tbWQtYnJpZWZjYXNlIiwiZW50cmllcyI6W3sibmFtZSI6IlF1ZXN0Ym9vayIsImlj
b24iOiJpb24tbWQtYnJpZWZjYXNlIiwicGF0aCI6Ii9jb21wYW55LzIzMTA1In0seyJuYW1lIjoi
SW52ZXN0bWVudHMiLCJpY29uIjoiaW9uLWlvcy1yZXR1cm4tcmlnaHQiLCJwYXRoIjoiL2NvbXBh
bnkvMjMxMDUvaW52ZXN0bWVudHMifSx7Im5hbWUiOiJEZW1vIERheSBMZWFkcyIsImljb24iOiJp
b24taW9zLXJldHVybi1yaWdodCIsInBhdGgiOiIvY29tcGFueS8yMzEwNS9kZW1vX2RheV9pbnZl
c3RvcnMifSx7Im5hbWUiOiJSYXRlIHlvdXIgaW52ZXN0b3JzIiwiaWNvbiI6Imlvbi1pb3MtcmV0
dXJuLXJpZ2h0IiwicGF0aCI6Ii9pbnZlc3Rvcl9ncmFkZXMifSx7Im5hbWUiOiJJbnZlc3RvciBV
cGRhdGVzIiwiaWNvbiI6Imlvbi1pb3MtcmV0dXJuLXJpZ2h0IiwicGF0aCI6Ii9jb21wYW5pZXMv
MjMxNTUvY29tcGFueV91cGRhdGVzIn1dfV0sInJpZ2h0IjpbeyJuYW1lIjoiTWFkaGF2YW4iLCJp
Y29uIjoiaW9uLW1kLWNvbnRhY3QiLCJ0eXBlIjoidXNlciIsImVudHJpZXMiOlt7Im5hbWUiOiJN
eSBQcm9maWxlIiwiaWNvbiI6Imlvbi1tZC1jb250YWN0IiwicGF0aCI6Ii91c2VyLzE4Mjg1MyJ9
LHsibmFtZSI6IkZvcnVtIE5vdGlmaWNhdGlvbnMiLCJpY29uIjoiaW9uLW1kLW5vdGlmaWNhdGlv
bnMiLCJwYXRoIjoiL2ZvcnVtL25vdGlmaWNhdGlvbnMifSx7Im5hbWUiOiJGb3J1bSBLZXl3b3Jk
IEFsZXJ0cyIsImljb24iOiJpb24tbWQtaGVhZHNldCIsInBhdGgiOiIvZm9ydW1fYWxlcnRzIn0s
eyJuYW1lIjoiTG9nIE91dCIsImljb24iOiJpb24tbWQtbG9nLW91dCIsInBhdGgiOiIvc2Vzc2lv
bi9sb2dvdXQifV19XX0sImJyYW5kSW1hZ2VVcmwiOiJodHRwczovL2Jvb2tmYWNlLnljb21iaW5h
dG9yLmNvbS9hc3NldHMveWNvbWJpbmF0b3ItbG9nby0zN2NmMDMwZmJjMjU1ZmM3MWQxOWFhMjFi
ZDViMzIwNzZhYTIwNmU4ZmJkMDEyMWM5MjQ3ZGIyYWRjYmQ3ODUxLnBuZyIsImJyYW5kSHJlZiI6
Ii9ob21lIiwiY3VycmVudFVzZXIiOnsiYXZhdGFyVGh1bWJVcmwiOiJodHRwczovL2Jvb2tmYWNl
LWltYWdlcy5zMy5hbWF6b25hd3MuY29tL2F2YXRhcnMvYTVjMDVjMDg3Y2YwYjI1Y2YwZTA4NjU0
ZTJkOTUxMjhlMzc5YjdlYy5qcGcifSwiY3VycmVudFBhdGgiOiIvaG9tZSIsInNlYXJjaFZpc2li
bGUiOnRydWUsInN1Ym5hdiI6bnVsbCwiaW5XYWFzIjpmYWxzZSwid2Fhc0hyZWYiOiJodHRwczov
L2Jvb2tmYWNlLnljb21iaW5hdG9yLmNvbS93b3JrYXRhc3RhcnR1cC9kYXNoYm9hcmQiLCJoYXNC
b29rZmFjZSI6dHJ1ZSwibG9nZ2VkSW4iOnRydWUsInJlbGVhc2VOb3RlcyI6eyJub3RlcyI6W10s
InR5cGUiOiJib29rZmFjZSIsInNpbmNlIjpudWxsfSwiYm9yZGVyVHlwZSI6Ik5vbmUiLCJuZXdT
ZWFyY2hVc2VyIjpudWxsfTwvc2NyaXB0PgogICAgICAKPCEtLSBBbXBsaXR1ZGUgLS0+PHNjcmlw
dD4oZnVuY3Rpb24oZSx0KXt2YXIgbj1lLmFtcGxpdHVkZXx8e19xOltdLF9pcTp7fX07dmFyIHI9
dC5jcmVhdGVFbGVtZW50KCJzY3JpcHQiKQpyLnR5cGU9InRleHQvamF2YXNjcmlwdCI7CnIuaW50
ZWdyaXR5PSJzaGEzODQtNWZoekM4WHczbSt4NWNCYWc0QU1LUmRmOTAwdnczQW9hTHR5MnZZZmNL
SVgxaUVzWVJIWkY0UkxYSXN1Mm8rRiIKci5jcm9zc09yaWdpbj0iYW5vbnltb3VzIjtyLmFzeW5j
PXRydWU7CnIuc3JjPSJodHRwczovL2Nkbi5hbXBsaXR1ZGUuY29tL2xpYnMvYW1wbGl0dWRlLTgu
MjEuNC1taW4uZ3ouanMiOwpyLm9ubG9hZD1mdW5jdGlvbigpe2lmKCFlLmFtcGxpdHVkZS5ydW5R
dWV1ZWRGdW5jdGlvbnMpe2NvbnNvbGUubG9nKAoiW0FtcGxpdHVkZV0gRXJyb3I6IGNvdWxkIG5v
dCBsb2FkIFNESyIpfX07dmFyIHM9dC5nZXRFbGVtZW50c0J5VGFnTmFtZSgic2NyaXB0IgopWzBd
O3MucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUocixzKTtmdW5jdGlvbiBpKGUsdCl7ZS5wcm90b3R5
cGVbdF09ZnVuY3Rpb24oKXsKdGhpcy5fcS5wdXNoKFt0XS5jb25jYXQoQXJyYXkucHJvdG90eXBl
LnNsaWNlLmNhbGwoYXJndW1lbnRzLDApKSk7cmV0dXJuIHRoaXN9fQp2YXIgbz1mdW5jdGlvbigp
e3RoaXMuX3E9W107cmV0dXJuIHRoaXN9O3ZhciBhPVsiYWRkIiwiYXBwZW5kIiwiY2xlYXJBbGwi
LAoicHJlcGVuZCIsInNldCIsInNldE9uY2UiLCJ1bnNldCIsInByZUluc2VydCIsInBvc3RJbnNl
cnQiLCJyZW1vdmUiXTtmb3IoCnZhciBjPTA7YzxhLmxlbmd0aDtjKyspe2kobyxhW2NdKX1uLklk
ZW50aWZ5PW87dmFyIGw9ZnVuY3Rpb24oKXt0aGlzLl9xPVtdOwpyZXR1cm4gdGhpc307dmFyIHU9
WyJzZXRQcm9kdWN0SWQiLCJzZXRRdWFudGl0eSIsInNldFByaWNlIiwic2V0UmV2ZW51ZVR5cGUi
LAoic2V0RXZlbnRQcm9wZXJ0aWVzIl07Zm9yKHZhciBwPTA7cDx1Lmxlbmd0aDtwKyspe2kobCx1
W3BdKX1uLlJldmVudWU9bDt2YXIgZD1bCiJpbml0IiwibG9nRXZlbnQiLCJsb2dSZXZlbnVlIiwi
c2V0VXNlcklkIiwic2V0VXNlclByb3BlcnRpZXMiLCJzZXRPcHRPdXQiLAoic2V0VmVyc2lvbk5h
bWUiLCJzZXREb21haW4iLCJzZXREZXZpY2VJZCIsImVuYWJsZVRyYWNraW5nIiwKInNldEdsb2Jh
bFVzZXJQcm9wZXJ0aWVzIiwiaWRlbnRpZnkiLCJjbGVhclVzZXJQcm9wZXJ0aWVzIiwic2V0R3Jv
dXAiLAoibG9nUmV2ZW51ZVYyIiwicmVnZW5lcmF0ZURldmljZUlkIiwiZ3JvdXBJZGVudGlmeSIs
Im9uSW5pdCIsIm9uTmV3U2Vzc2lvblN0YXJ0IgosImxvZ0V2ZW50V2l0aFRpbWVzdGFtcCIsImxv
Z0V2ZW50V2l0aEdyb3VwcyIsInNldFNlc3Npb25JZCIsInJlc2V0U2Vzc2lvbklkIiwKImdldERl
dmljZUlkIiwiZ2V0VXNlcklkIiwic2V0TWluVGltZUJldHdlZW5TZXNzaW9uc01pbGxpcyIsCiJz
ZXRFdmVudFVwbG9hZFRocmVzaG9sZCIsInNldFVzZUR5bmFtaWNDb25maWciLCJzZXRTZXJ2ZXJa
b25lIiwic2V0U2VydmVyVXJsIiwKInNlbmRFdmVudHMiLCJzZXRMaWJyYXJ5Iiwic2V0VHJhbnNw
b3J0Il07ZnVuY3Rpb24gdih0KXtmdW5jdGlvbiBlKGUpe3RbZQpdPWZ1bmN0aW9uKCl7dC5fcS5w
dXNoKFtlXS5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLDApKSl9
fQpmb3IodmFyIG49MDtuPGQubGVuZ3RoO24rKyl7ZShkW25dKX19dihuKTtuLmdldEluc3RhbmNl
PWZ1bmN0aW9uKGUpe2U9KAohZXx8ZS5sZW5ndGg9PT0wPyIkZGVmYXVsdF9pbnN0YW5jZSI6ZSku
dG9Mb3dlckNhc2UoKTtpZigKIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChu
Ll9pcSxlKSl7bi5faXFbZV09e19xOltdfTt2KG4uX2lxW2VdKX0KcmV0dXJuIG4uX2lxW2VdfTtl
LmFtcGxpdHVkZT1ufSkod2luZG93LGRvY3VtZW50KTsKYW1wbGl0dWRlLmdldEluc3RhbmNlKCku
aW5pdCgiNzEyYzFhNGRiY2RiOWYzZmJhNmQ0YWE1MDI1MDExMmUiLCBudWxsLCB7aW5jbHVkZVJl
ZmVycmVyOiB0cnVlLCBpbmNsdWRlVXRtOiB0cnVlLCBpbmNsdWRlR2NsaWQ6IHRydWV9KTs8L3Nj
cmlwdD48c2NyaXB0PndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCJsb2FkIiwgZnVuY3Rpb24oZSkg
ewogIHNldFRpbWVvdXQoKCkgPT4gewogICAgdmFyIHRyYWl0cyA9IHsKICAgICAgZmlyc3RfbmFt
ZTogJ01hZGhhdmFuJywKICAgICAgbGFzdF9uYW1lOiAnTWFsb2xhbicsCiAgICAgIGNyZWF0ZWRf
YXQ6ICcyMDE3LTAzLTA3IDA4OjIwOjI2IFVUQycsCiAgICAgIGVtYWlsOiAnbWFkaGF2YW5AY3Jl
YXRvcm9zLmNvJywKICAgICAgaG5pZDogJ21hZGhhdmFubWFsb2xhbicsCiAgICAgIGNvbXBhbnk6
ICdRdWVzdGJvb2snLAogICAgICBiYXRjaDogJ3cyMDIxJywKICAgICAgYmF0Y2hlczogJ3cyMDIx
JywKICAgICAgaXNfeWM6ICd0cnVlJywKICAgICAgaXNfY29yZTogJ3RydWUnLAogICAgICBpc19m
ZWxsb3dzaGlwOiAnZmFsc2UnLAogICAgICBpc19hY3RpdmVfZm91bmRlcjogJ3RydWUnLAogICAg
ICBpc19pbnZlc3RvcjogJ2ZhbHNlJywKICAgICAgaXNfbWVkaWE6ICdmYWxzZScsCiAgICAgIGlu
X2N1cnJlbnRfYmF0Y2g6ICdmYWxzZScsCiAgICB9OwogICAgd2luZG93LmFtcGxpdHVkZS5nZXRJ
bnN0YW5jZSgpLnNldFVzZXJJZCgnMTgyODUzJykKICAgIHdpbmRvdy5hbXBsaXR1ZGUuZ2V0SW5z
dGFuY2UoKS5zZXRVc2VyUHJvcGVydGllcyh0cmFpdHMpOwogICAgd2luZG93LmFtcGxpdHVkZS5n
ZXRJbnN0YW5jZSgpLmxvZ0V2ZW50KCdMb2FkZWQgYSBQYWdlJywgewogICAgICBwYXRoOiBsb2Nh
dGlvbi5wYXRobmFtZSwKICAgICAgcmVmZXJyZXI6IGRvY3VtZW50LnJlZmVycmVyLAogICAgICBz
ZWFyY2g6IGxvY2F0aW9uLnNlYXJjaCwKICAgICAgdGl0bGU6IGRvY3VtZW50LnRpdGxlLAogICAg
ICB1cmw6IGxvY2F0aW9uLmhyZWYsCiAgICB9KTsKICB9LCAyNTAwKTsKfSk7PC9zY3JpcHQ+PCEt
LSBFbmQgQW1wbGl0dWRlIC0tPiAgPHNjcmlwdD4KICB3aW5kb3dbJ19mc19ob3N0J10gPSAnZnVs
bHN0b3J5LmNvbSc7CiAgd2luZG93WydfZnNfc2NyaXB0J10gPSAnZWRnZS5mdWxsc3RvcnkuY29t
L3MvZnMuanMnOwogIHdpbmRvd1snX2ZzX29yZyddID0gJ1lXS1c1JzsKICB3aW5kb3dbJ19mc19u
YW1lc3BhY2UnXSA9ICdGUyc7CiAgKGZ1bmN0aW9uKG0sbixlLHQsbCxvLGcseSl7CiAgICBpZiAo
ZSBpbiBtKSB7aWYobS5jb25zb2xlICYmIG0uY29uc29sZS5sb2cpIHsgbS5jb25zb2xlLmxvZygn
RnVsbFN0b3J5IG5hbWVzcGFjZSBjb25mbGljdC4gUGxlYXNlIHNldCB3aW5kb3dbIl9mc19uYW1l
c3BhY2UiXS4nKTt9IHJldHVybjt9CiAgICBnPW1bZV09ZnVuY3Rpb24oYSxiLHMpe2cucT9nLnEu
cHVzaChbYSxiLHNdKTpnLl9hcGkoYSxiLHMpO307Zy5xPVtdOwogICAgbz1uLmNyZWF0ZUVsZW1l
bnQodCk7by5hc3luYz0xO28uY3Jvc3NPcmlnaW49J2Fub255bW91cyc7by5zcmM9J2h0dHBzOi8v
JytfZnNfc2NyaXB0OwogICAgeT1uLmdldEVsZW1lbnRzQnlUYWdOYW1lKHQpWzBdO3kucGFyZW50
Tm9kZS5pbnNlcnRCZWZvcmUobyx5KTsKICAgIGcuaWRlbnRpZnk9ZnVuY3Rpb24oaSx2LHMpe2co
bCx7dWlkOml9LHMpO2lmKHYpZyhsLHYscyl9O2cuc2V0VXNlclZhcnM9ZnVuY3Rpb24odixzKXtn
KGwsdixzKX07Zy5ldmVudD1mdW5jdGlvbihpLHYscyl7ZygnZXZlbnQnLHtuOmkscDp2fSxzKX07
CiAgICBnLmFub255bWl6ZT1mdW5jdGlvbigpe2cuaWRlbnRpZnkoISEwKX07CiAgICBnLnNodXRk
b3duPWZ1bmN0aW9uKCl7ZygicmVjIiwhMSl9O2cucmVzdGFydD1mdW5jdGlvbigpe2coInJlYyIs
ITApfTsKICAgIGcubG9nID0gZnVuY3Rpb24oYSxiKXtnKCJsb2ciLFthLGJdKX07CiAgICBnLmNv
bnNlbnQ9ZnVuY3Rpb24oYSl7ZygiY29uc2VudCIsIWFyZ3VtZW50cy5sZW5ndGh8fGEpfTsKICAg
IGcuaWRlbnRpZnlBY2NvdW50PWZ1bmN0aW9uKGksdil7bz0nYWNjb3VudCc7dj12fHx7fTt2LmFj
Y3RJZD1pO2cobyx2KX07CiAgICBnLmNsZWFyVXNlckNvb2tpZT1mdW5jdGlvbigpe307CiAgICBn
LnNldFZhcnM9ZnVuY3Rpb24obiwgcCl7Zygnc2V0VmFycycsW24scF0pO307CiAgICBnLl93PXt9
O3k9J1hNTEh0dHBSZXF1ZXN0JztnLl93W3ldPW1beV07eT0nZmV0Y2gnO2cuX3dbeV09bVt5XTsK
ICAgIGlmKG1beV0pbVt5XT1mdW5jdGlvbigpe3JldHVybiBnLl93W3ldLmFwcGx5KHRoaXMsYXJn
dW1lbnRzKX07CiAgICBnLl92PSIxLjMuMCI7CiAgfSkod2luZG93LGRvY3VtZW50LHdpbmRvd1sn
X2ZzX25hbWVzcGFjZSddLCdzY3JpcHQnLCd1c2VyJyk7CgogIC8vIFRoaXMgaXMgYW4gZXhhbXBs
ZSBzY3JpcHQgLSBkb24ndCBmb3JnZXQgdG8gY2hhbmdlIGl0IQogIEZTLmlkZW50aWZ5KDE4Mjg1
MywgewogICAgZGlzcGxheU5hbWU6ICdNYWRoYXZhbiBNYWxvbGFuJywKICAgIGVtYWlsOiAnbWFk
aGF2YW5AY3JlYXRvcm9zLmNvJywKICB9KTsKICA8L3NjcmlwdD4KPCEtLSBHb29nbGUgQW5hbHl0
aWNzIC0tPgo8c2NyaXB0PgooZnVuY3Rpb24oaSxzLG8sZyxyLGEsbSl7aVsnR29vZ2xlQW5hbHl0
aWNzT2JqZWN0J109cjtpW3JdPWlbcl18fGZ1bmN0aW9uKCl7CihpW3JdLnE9aVtyXS5xfHxbXSku
cHVzaChhcmd1bWVudHMpfSxpW3JdLmw9MSpuZXcgRGF0ZSgpO2E9cy5jcmVhdGVFbGVtZW50KG8p
LAptPXMuZ2V0RWxlbWVudHNCeVRhZ05hbWUobylbMF07YS5hc3luYz0xO2Euc3JjPWc7bS5wYXJl
bnROb2RlLmluc2VydEJlZm9yZShhLG0pCn0pKHdpbmRvdyxkb2N1bWVudCwnc2NyaXB0JywnLy93
d3cuZ29vZ2xlLWFuYWx5dGljcy5jb20vYW5hbHl0aWNzLmpzJywnZ2EnKTsKCmdhKCdjcmVhdGUn
LCAnVUEtNjY0NTIyMTAtMScsICdhdXRvJywgeydsZWdhY3lDb29raWVEb21haW4nOiAnYm9va2Zh
Y2UueWNvbWJpbmF0b3IuY29tJ30pOwpnYSgnc2V0JywgJ3VzZXJJZCcsIDE4Mjg1Myk7IC8vIFNl
dCB0aGUgdXNlciBJRCB1c2luZyBzaWduZWQtaW4gdXNlcl9pZC4KZ2EoJ3NldCcsICdkaW1lbnNp
b24xJywgZmFsc2UpOwpnYSgnc2V0JywgJ2RpbWVuc2lvbjInLCAndzIwMjEnKTsKZ2EoJ3NldCcs
ICdkaW1lbnNpb24zJywgdHJ1ZSk7CmdhKCdzZXQnLCAnZGltZW5zaW9uNCcsIHRydWUpOwpnYSgn
c2VuZCcsICdwYWdldmlldycpOwoKPC9zY3JpcHQ+CjwhLS0gRW5kIEdvb2dsZSBBbmFseXRpY3Mg
LS0+CjwvYm9keT48L2h0bWw+DQowDQoNCg==`, 'base64')