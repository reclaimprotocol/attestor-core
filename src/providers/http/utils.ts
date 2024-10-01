// noinspection ExceptionCaughtLocallyJS

import { concatenateUint8Arrays } from '@reclaimprotocol/tls'
import {
	ArrayExpression,
	Expression,
	ExpressionStatement,
	ObjectExpression,
	parseScript,
	Property,
	Syntax
} from 'esprima-next'
import { JSONPath } from 'jsonpath-plus'
import { ArraySlice, CompleteTLSPacket, ProviderParams, Transcript } from 'src/types'
import { getHttpRequestDataFromTranscript, HttpRequest, HttpResponse, isApplicationData, makeHttpResponseParser, REDACTION_CHAR_CODE } from 'src/utils'

export type JSONIndex = {
    start: number
    end: number
}

type HTTPProviderParams = ProviderParams<'http'>

let RE2
try {
	RE2 = require('re2')
	if(!Object.keys(RE2).length) {
		RE2 = undefined
		throw new Error()
	}
} catch{
	console.log('RE2 not found. Using standard regex')
}

let jsd

if(typeof window !== 'undefined') {
	// @ts-ignore
	jsd = window.jsdom
} else {
	jsd = require('jsdom')
}

/**
 * Returns only first extracted element
 * @param html
 * @param xpathExpression
 * @param contentsOnly
 */
export function extractHTMLElement(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): string {
	const { start, end } = extractHTMLElementIndex(html, xpathExpression, contentsOnly)
	return html.slice(start, end)
}

/**
 * Returns all extracted elements
 * @param html
 * @param xpathExpression
 * @param contentsOnly
 */
export function extractHTMLElements(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): string[] {
	const indexes = extractHTMLElementsIndexes(html, xpathExpression, contentsOnly)
	const res: string[] = []
	for(const { start, end } of indexes) {
		res.push(html.slice(start, end))
	}

	return res
}

/**
 * returns a single index of extracted element
 * @param html
 * @param xpathExpression
 * @param contentsOnly
 */
export function extractHTMLElementIndex(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): { start: number, end: number } {
	return extractHTMLElementsIndexes(html, xpathExpression, contentsOnly)[0]
}

/**
 * Returns indexes of all extracted elements
 * @param html
 * @param xpathExpression
 * @param contentsOnly
 */
export function extractHTMLElementsIndexes(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): { start: number, end: number }[] {

	const dom = new jsd.JSDOM(html, {
		contentType: 'text/html',
		includeNodeLocations: true
	})

	const document = dom.window.document
	const xpathResult = document.evaluate(xpathExpression, document, null, dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
	const nodes: Node[] = []
	if(xpathResult?.resultType === dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE &&
		xpathResult?.snapshotLength) {
		for(let i = 0; i < xpathResult.snapshotLength; ++i) {
			nodes.push(xpathResult.snapshotItem(i))
		}
	}

	if(!nodes.length) {
		throw new Error(`Failed to find XPath: "${xpathExpression}"`)
	}


	const res: { start: number, end: number }[] = []

	for(const node of nodes) {
		const nodeLocation = dom.nodeLocation(node)
		if(!nodeLocation) {
			throw new Error(`Failed to find XPath node location: "${xpathExpression}"`)
		}

		if(contentsOnly) {
			const start = nodeLocation.startTag ? nodeLocation.startTag.endOffset : nodeLocation.startOffset
			const end = nodeLocation.endTag ? nodeLocation.endTag.startOffset : nodeLocation.endOffset
			res.push({ start, end })
		} else {
			res.push({ start:nodeLocation.startOffset, end: nodeLocation.endOffset })
		}
	}

	return res
}

export function extractJSONValueIndex(json: string, jsonPath: string) {
	return extractJSONValueIndexes(json, jsonPath)[0]
}

export function extractJSONValueIndexes(json: string, jsonPath: string): { start: number, end: number }[] {
	const pointers = JSONPath({
		path: jsonPath,
		json: JSON.parse(json),
		wrap: false,
		resultType: 'pointer',
		eval:'safe',
		// @ts-ignore
		ignoreEvalErrors: true
	})
	if(!pointers) {
		throw new Error('jsonPath not found')
	}

	const tree = parseScript('(' + json + ')', { range: true }) //wrap in parentheses for esprima to parse
	if(tree.body[0] instanceof ExpressionStatement
		&& (tree.body[0].expression instanceof ObjectExpression || tree.body[0].expression instanceof ArrayExpression)) {

		const traversePointers = Array.isArray(pointers) ? pointers : [pointers]
		const res: { start: number, end: number }[] = []
		for(const pointer of traversePointers) {
			const index = traverse(tree.body[0].expression, '', [pointer])
			if(index) {
				res.push({
					start: index.start - 1, //account for '('
					end: index.end - 1,
				})
			}
		}

		return res
	}

	throw new Error('jsonPath not found')
}

/**
 * recursively go through AST tree and build a JSON path while it's not equal to the one we search for
 * @param o - esprima expression for root object
 * @param path - path that is being built
 * @param pointers - JSON pointers to compare to
 */
function traverse(
	o: Expression,
	path: string,
	pointers: string[]
): JSONIndex | null {
	if(o instanceof ObjectExpression) {
		for(const p of o.properties) {
			if(!(p instanceof Property)) {
				continue
			}

			const localPath = p.key.type === Syntax.Literal
				? path + '/' + p.key.value
				: path

			if(pointers.includes(localPath) && 'range' in p && Array.isArray(p.range)) {
				return {
					start: p.range[0],
					end: p.range[1],
				}
			}

			if(
				p.value instanceof ObjectExpression
				|| p.value instanceof ArrayExpression
			) {
				const res = traverse(p.value, localPath, pointers)
				if(res) {
					return res
				}
			}
		}
	}

	if(o instanceof ArrayExpression) {
		for(let i = 0; i < o.elements.length; i++) {
			const element = o.elements[i]
			if(!element) {
				continue
			}

			const localPath = path + '/' + i

			if(
				pointers.includes(localPath) &&
                'range' in element &&
                Array.isArray(element.range)
			) {
				return {
					start: element.range[0],
					end: element.range[1],
				}
			}

			if(element instanceof ObjectExpression) {
				const res = traverse(element, localPath, pointers)
				if(res) {
					return res
				}
			}

			if(element instanceof ArrayExpression) {
				const res = traverse(element, localPath, pointers)
				if(res) {
					return res
				}
			}
		}
	}

	return null
}

export function buildHeaders(input: HTTPProviderParams['headers']) {
	const headers: string[] = []

	for(const [key, value] of Object.entries(input || {})) {
		headers.push(`${key}: ${value}`)
	}

	return headers
}

/**
 * Converts position in HTTP response body to an absolute position in TLS transcript considering chunked encoding
 * @param pos
 * @param bodyStartIdx
 * @param chunks
 */
export function convertResponsePosToAbsolutePos(pos: number, bodyStartIdx: number, chunks?: ArraySlice[]): number {
	if(chunks?.length) {
		let chunkBodyStart = 0
		for(const chunk of chunks) {

			const chunkSize = chunk.toIndex - chunk.fromIndex

			if(pos >= chunkBodyStart && pos <= (chunkBodyStart + chunkSize)) {
				return pos - chunkBodyStart + chunk.fromIndex
			}

			chunkBodyStart += chunkSize
		}

		throw new Error('position out of range')
	}

	return bodyStartIdx + pos
}

/**
 * Returns parts of response which contain chunk headers and must be redacted out
 * of revealed response part
 * @param from
 * @param to
 * @param chunks
 */
export function getRedactionsForChunkHeaders(from, to: number, chunks?: ArraySlice[]): ArraySlice[] {
	const res: ArraySlice[] = []
	if(chunks?.length) {
		for(let i = 1; i < chunks?.length; i++) {
			if(chunks[i].fromIndex > from && chunks[i].fromIndex < to) {
				res.push({ fromIndex:chunks[i - 1].toIndex, toIndex:chunks[i].fromIndex })
			}
		}
	}

	return res
}

export function parseHttpResponse(buff: Uint8Array) {
	const parser = makeHttpResponseParser()
	parser.onChunk(buff)
	parser.streamEnded()
	return parser.res
}

export function makeRegex(str: string) {
	if(RE2 !== undefined) {
		return RE2(str, 'sgiu')
	}

	return new RegExp(str, 'sgi')
}

const TEMPLATE_START_CHARCODE = '{'.charCodeAt(0)
const TEMPLATE_END_CHARCODE = '}'.charCodeAt(0)

/**
 * Try to match strings that contain templates like {{param}}
 * against redacted string that has *** instead of that param
 */
export function matchRedactedStrings(templateString: Uint8Array, redactedString?: Uint8Array): boolean {

	if(templateString.length === 0 && redactedString?.length === 0) {
		return true
	}

	if(!redactedString) {
		return false
	}

	let ts = -1
	let rs = -1
	while(ts < templateString.length && rs < redactedString.length) {
		let ct = getTChar()
		let cr = getRChar()
		if(ct !== cr) {
			// only valid if param contains "{" & redacted contains "*"
			if(ct === TEMPLATE_START_CHARCODE && cr === REDACTION_CHAR_CODE) {
				//check that the char after first "{" is also "{"
				if(getTChar() !== TEMPLATE_START_CHARCODE) {
					return false
				}

				//look for first closing bracket
				while(((ct = getTChar()) !== TEMPLATE_END_CHARCODE) && ct !== -1) {
				}

				//look for second closing bracket
				while(((ct = getTChar()) !== TEMPLATE_END_CHARCODE) && ct !== -1) {
				}

				if(ct === -1) {
					return false
				}

				//find the end of redaction
				while(((cr = getRChar()) === REDACTION_CHAR_CODE) && cr !== -1) {
				}

				if(cr === -1) {
					//if there's nothing after template too then both ended at the end of strings
					return getTChar() === -1
				}

				//rewind redacted string position back 1 char because we read one extra
				rs--
			} else {
				return false
			}
		}
	}


	function getTChar(): number {
		ts++
		if(ts < templateString.length) {
			return templateString[ts]
		} else {
			return -1
		}
	}

	function getRChar(): number {
		if(!redactedString) {
			return -1
		}

		rs++
		if(rs < redactedString.length) {
			return redactedString[rs]
		} else {
			return -1
		}
	}

	return ts === templateString.length && rs === redactedString.length
}

export function generateRequstAndResponseFromTranscript(transcript: Transcript<CompleteTLSPacket>, tlsVersion: string): { req: HttpRequest, res: HttpResponse } {
	const allPackets = transcript

	const packets: Transcript<Uint8Array> = []
	for(const b of allPackets) {
		if(b.message.type !== 'ciphertext'
			|| !isApplicationData(b.message, tlsVersion)) {
			continue
		}

		const plaintext = tlsVersion === 'TLS1_3'
			? b.message.plaintext.slice(0, -1)
			: b.message.plaintext

		packets.push({
			message: plaintext,
			sender: b.sender
		})
	}

	const req = getHttpRequestDataFromTranscript(packets)

	const responsePackets = concatenateUint8Arrays(packets.filter(p => p.sender === 'server').map(p => p.message).filter(b => !b.every(b => b === REDACTION_CHAR_CODE)))
	const res = parseHttpResponse(responsePackets)

	return { req, res }
}