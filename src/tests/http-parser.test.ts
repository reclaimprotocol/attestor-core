import { strToUint8Array } from '@reclaimprotocol/tls'
import assert from 'node:assert'
import { describe, it } from 'node:test'
import { TEST_RES_BODY_CHUNKS, TEST_RES_CHUNKED_PARTIAL_BODY } from 'src/tests/utils.ts'

import { uint8ArrayToStr } from '#src/utils/generics.ts'
import { makeHttpResponseParser } from '#src/utils/http-parser.ts'

const MODES = ['complete', 'byte-by-byte'] as const

for(const parseMode of MODES) {
	describe(`HTTP Parser tests (mode=${parseMode})`, () => {

		it('should parse a response', () => {
			const res = parseHttpResponse(RES1, parseMode)
			assert.equal(
				RES1
					.subarray(0, res.statusLineEndIndex)
					.toString(),
				'HTTP/1.1 401 Unauthorized'
			)

			assert.ok(res.complete)
			assert.equal(res.statusCode, 401)
			assert.ok(res.body.length > 0)

			const json = JSON.parse(uint8ArrayToStr(res.body))
			assert.equal(json.error.code, 401)
		})

		it('should parse an empty body response', () => {
			const res = parseHttpResponse(
				strToUint8Array(RES_EMPTY),
				parseMode
			)
			assert.ok(res.complete)
			assert.equal(res.statusCode, 200)
			assert.equal(res.body.length, 0)
		})

		it('should parse an empty chunked response', () => {
			const res = parseHttpResponse(
				strToUint8Array(RES_EMPTY_CHUNKED),
				parseMode
			)
			assert.ok(res.complete)
			assert.equal(res.statusCode, 200)
			assert.equal(res.body.length, 0)
		})

		it('should read a set content-length', () => {
			const buff = strToUint8Array(RES_BODY)
			const res = parseHttpResponse(buff, parseMode)
			assert.ok(res.complete)

			assert.ok(res.bodyStartIndex)
			assert.deepEqual(buff.slice(res.bodyStartIndex), res.body)

			const json = JSON.parse(uint8ArrayToStr(res.body))
			assert.ok(json.name)
		})

		it('should correctly set chunk indices', () => {
			const buff = strToUint8Array(TEST_RES_CHUNKED_PARTIAL_BODY)
			const res = parseHttpResponse(buff, parseMode)
			assert.ok(res.complete)

			// ensure all chunks are parsed correctly
			const parsedChunks = res.chunks?.map((chunk) => {
				return uint8ArrayToStr(
					buff.slice(chunk.fromIndex, chunk.toIndex)
				)
			})
			assert.deepEqual(parsedChunks, TEST_RES_BODY_CHUNKS)

			const json = JSON.parse(uint8ArrayToStr(res.body))
			assert.ok(json.name)
		})
	})
}

describe('General HTTP Parser Tests', () => {

	it('should correctly parse an empty body response', () => {
		const str = 'HTTP/1.1 302 \r\nset-cookie: JSESSIONID=X; Path=/; Secure; HttpOnly\r\nx-content-type-options: nosniff\r\nx-xss-protection: 1; mode=block\r\nstrict-transport-security: max-age=31536000 ; includeSubDomains\r\nlocation: https://xyz.com/abcd\r\ncontent-length: 0\r\ndate: Sun, 16 Jun 2024 07:12:03 GMT\r\nconnection: close\r\nSet-Cookie: XYZ; path=/; Httponly; Secure\r\nSet-Cookie: ROUTEID=.node-U01; Path=/; Httponly; Secure\r\n\r\n'
		const buff = strToUint8Array(str)
		const parser = makeHttpResponseParser()
		parser.onChunk(buff)

		assert.ok(parser.res.complete)
	})
})

function parseHttpResponse(buff: Uint8Array, mode: 'complete' | 'byte-by-byte') {
	const parser = makeHttpResponseParser()
	if(mode === 'complete') {
		parser.onChunk(buff)
	} else {
		for(const byte of buff) {
			parser.onChunk(new Uint8Array([byte]))
		}
	}

	parser.streamEnded()
	return parser.res
}

const RES1 = Buffer.from(
	'SFRUUC8xLjEgNDAxIFVuYXV0aG9yaXplZA0KV1dXLUF1dGhlbnRpY2F0ZTogQmVhcmVyIHJlYWxtPSJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vIiwgZXJyb3I9ImludmFsaWRfdG9rZW4iDQpWYXJ5OiBYLU9yaWdpbg0KVmFyeTogUmVmZXJlcg0KQ29udGVudC1UeXBlOiBhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PVVURi04DQpEYXRlOiBUdWUsIDEzIERlYyAyMDIyIDAzOjU1OjM1IEdNVA0KU2VydmVyOiBFU0YNCkNhY2hlLUNvbnRyb2w6IHByaXZhdGUNClgtWFNTLVByb3RlY3Rpb246IDANClgtRnJhbWUtT3B0aW9uczogU0FNRU9SSUdJTg0KWC1Db250ZW50LVR5cGUtT3B0aW9uczogbm9zbmlmZg0KQWNjZXB0LVJhbmdlczogbm9uZQ0KVmFyeTogT3JpZ2luLEFjY2VwdC1FbmNvZGluZw0KVHJhbnNmZXItRW5jb2Rpbmc6IGNodW5rZWQNCkFsdC1TdmM6IGgzPSI6NDQzIjsgbWE9MjU5MjAwMCxoMy0yOT0iOjQ0MyI7IG1hPTI1OTIwMDAsaDMtUTA1MD0iOjQ0MyI7IG1hPTI1OTIwMDAsaDMtUTA0Nj0iOjQ0MyI7IG1hPTI1OTIwMDAsaDMtUTA0Mz0iOjQ0MyI7IG1hPTI1OTIwMDAscXVpYz0iOjQ0MyI7IG1hPTI1OTIwMDA7IHY9IjQ2LDQzIg0KQ29ubmVjdGlvbjogY2xvc2UNCg0KMTI5DQp7CiAgImVycm9yIjogewogICAgImNvZGUiOiA0MDEsCiAgICAibWVzc2FnZSI6ICJSZXF1ZXN0IGhhZCBpbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNyZWRlbnRpYWxzLiBFeHBlY3RlZCBPQXV0aCAyIGFjY2VzcyB0b2tlbiwgbG9naW4gY29va2llIG9yIG90aGVyIHZhbGlkIGF1dGhlbnRpY2F0aW9uIGNyZWRlbnRpYWwuIFNlZSBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9pZGVudGl0eS9zaWduLWluL3dlYi9kZXZjb25zb2xlLXByb2plY3QuIiwKICAgICJzdGF0dXMiOiAiVU5BVVRIRU5USUNBVEVEIgogIH0KfQoNCg==',
	'base64',
)

const RES_EMPTY = [
	'HTTP/1.1 200 OK',
	'Content-Type: application/json',
	'Content-Length: 0',
	'', //empty line
	'',
].join('\r\n')

const BODY_JSON = '{"name":"John","age":30,"car":null}'
const RES_BODY = [
	'HTTP/1.1 200 OK',
	'Content-Type: application/json',
	'Content-Length: ' + BODY_JSON.length,
	'',
	BODY_JSON
].join('\r\n')

const RES_EMPTY_CHUNKED = [
	'HTTP/1.1 200 OK',
	'Content-Type: application/json',
	'Transfer-Encoding: chunked',
	'',
	'0',
	'',
].join('\r\n')