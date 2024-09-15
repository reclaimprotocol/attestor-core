import { strToUint8Array } from '@reclaimprotocol/tls'
import { uint8ArrayToStr } from 'src/utils/generics'
import { makeHttpResponseParser } from 'src/utils/http-parser'

describe.each(['complete', 'byte-by-byte'] as const)('HTTP Parser tests (mode=%s)', (parseMode) => {

	it('should parse a response', () => {
		const res = parseHttpResponse(RES1, parseMode)
		expect(
			RES1
				.subarray(0, res.statusLineEndIndex)
				.toString()
		).toEqual('HTTP/1.1 401 Unauthorized')

		expect(res.complete).toEqual(true)
		expect(res.statusCode).toEqual(401)
		expect(res.body.length).toBeGreaterThan(0)

		const json = JSON.parse(uint8ArrayToStr(res.body))
		expect(json.error.code).toEqual(401)
	})

	it('should parse an empty body response', () => {
		const res = parseHttpResponse(
			strToUint8Array(RES_EMPTY),
			parseMode
		)
		expect(res.complete).toEqual(true)
		expect(res.statusCode).toEqual(200)
		expect(res.body.length).toEqual(0)
	})

	it('should parse an empty chunked response', () => {
		const res = parseHttpResponse(
			strToUint8Array(RES_EMPTY_CHUNKED),
			parseMode
		)
		expect(res.complete).toEqual(true)
		expect(res.statusCode).toEqual(200)
		expect(res.body.length).toEqual(0)
	})

	it('should read a set content-length', () => {
		const buff = strToUint8Array(RES_BODY)
		const res = parseHttpResponse(buff, parseMode)
		expect(res.complete).toEqual(true)

		expect(res.bodyStartIndex).toBeTruthy()
		expect(
			buff.slice(res.bodyStartIndex)
		).toEqual(res.body)

		const json = JSON.parse(uint8ArrayToStr(res.body))
		expect(json.name).toBeTruthy()
	})

	it('should correctly set chunk indices', () => {
		const buff = strToUint8Array(RES_CHUNKED_PARTIAL_BODY)
		const res = parseHttpResponse(buff, parseMode)
		expect(res.complete).toEqual(true)

		// ensure all chunks are parsed correctly
		const parsedChunks = res.chunks?.map((chunk) => {
			return uint8ArrayToStr(
				buff.slice(chunk.fromIndex, chunk.toIndex)
			)
		})
		expect(parsedChunks).toEqual(CHUNKS)

		const json = JSON.parse(uint8ArrayToStr(res.body))
		expect(json.name).toBeTruthy()
	})
})

describe('General HTTP Parser Tests', () => {

	it('should correctly parse an empty body response', () => {
		const str = 'HTTP/1.1 302 \r\nset-cookie: JSESSIONID=X; Path=/; Secure; HttpOnly\r\nx-content-type-options: nosniff\r\nx-xss-protection: 1; mode=block\r\nstrict-transport-security: max-age=31536000 ; includeSubDomains\r\nlocation: https://xyz.com/abcd\r\ncontent-length: 0\r\ndate: Sun, 16 Jun 2024 07:12:03 GMT\r\nconnection: close\r\nSet-Cookie: XYZ; path=/; Httponly; Secure\r\nSet-Cookie: ROUTEID=.node-U01; Path=/; Httponly; Secure\r\n\r\n'
		const buff = strToUint8Array(str)
		const parser = makeHttpResponseParser()
		parser.onChunk(buff)

		expect(parser.res.complete).toEqual(true)
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

const CHUNKS = [
	'{"name":"John",',
	'"age":30,',
	'"car":null',
	'}'
]

const RES_CHUNKED_PARTIAL_BODY = [
	'HTTP/1.1 200 OK',
	'Content-Type: application/json',
	'Transfer-Encoding: chunked',
	'',
	...CHUNKS.flatMap((chunk) => {
		const chunkSize = chunk.length.toString(16)
		return [chunkSize, chunk]
	}),
	'0',
	'',
	''
].join('\r\n')