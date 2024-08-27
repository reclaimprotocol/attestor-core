// noinspection ExceptionCaughtLocallyJS

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
import { ArraySlice, ProviderParams } from '../../types'
import { makeHttpResponseParser, REDACTION_CHAR_CODE } from '../../utils'

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

export function extractHTMLElement(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): string {
	const { start, end } = extractHTMLElementIndex(html, xpathExpression, contentsOnly)
	return html.slice(start, end)
}

export function extractHTMLElementIndex(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): { start: number, end: number } {

	const dom = new jsd.JSDOM(html, {
		contentType: 'text/html',
		includeNodeLocations: true
	})

	const document = dom.window.document
	const node = document
		.evaluate(xpathExpression, document, null, dom.window.XPathResult.FIRST_ORDERED_NODE_TYPE, null)
		?.singleNodeValue
	if(!node) {
		throw new Error(`Failed to find XPath: "${xpathExpression}"`)
	}

	const nodeLocation = dom.nodeLocation(node)
	if(!nodeLocation) {
		throw new Error(`Failed to find XPath node location: "${xpathExpression}"`)
	}

	if(contentsOnly) {
		const start = nodeLocation.startTag.endOffset
		const end = nodeLocation.endTag.startOffset
		return { start, end }
	} else {
		return { start:nodeLocation.startOffset, end: nodeLocation.endOffset }
	}
}

export function extractJSONValueIndex(json: string, jsonPath: string) {
	const pointers = JSONPath({
		path: jsonPath,
		json: JSON.parse(json),
		wrap: false,
		resultType: 'pointer',
		eval:'safe'
	})
	if(!pointers) {
		throw new Error('jsonPath not found')
	}

	const tree = parseScript('(' + json + ')', { range: true }) //wrap in parentheses for esprima to parse
	if(tree.body[0] instanceof ExpressionStatement
		&& (tree.body[0].expression instanceof ObjectExpression || tree.body[0].expression instanceof ArrayExpression)) {
		const index = traverse(tree.body[0].expression, '', pointers)
		if(index) {
			return {
				start: index.start - 1, //account for '('
				end: index.end - 1,
			}
		}
	}

	throw new Error('jsonPath not found')
}

/**
 * recursively go through AST tree and build a JSON path while it's not equal to the one we search for
 * @param o - esprima expression for root object
 * @param path - path that is being built
 * @param pointer - JSON pointer to compare to
 */
function traverse(
	o: Expression,
	path: string,
	pointer: string
): JSONIndex | null {
	if(o instanceof ObjectExpression) {
		for(const p of o.properties) {
			if(p instanceof Property) {
				let localPath
				if(p.key.type === Syntax.Literal) {
					localPath = path + '/' + p.key.value
				} else {
					localPath = path
				}

				if(localPath === pointer && 'range' in p && Array.isArray(p.range)) {
					return {
						start: p.range[0],
						end: p.range[1],
					}
				}

				if(p.value instanceof ObjectExpression) {
					const res = traverse(p.value, localPath, pointer)
					if(res) {
						return res
					}
				}

				if(p.value instanceof ArrayExpression) {
					const res = traverse(p.value, localPath, pointer)
					if(res) {
						return res
					}
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
				localPath === pointer &&
                'range' in element &&
                Array.isArray(element.range)
			) {
				return {
					start: element.range[0],
					end: element.range[1],
				}
			}

			if(element instanceof ObjectExpression) {
				const res = traverse(element, localPath, pointer)
				if(res) {
					return res
				}
			}

			if(element instanceof ArrayExpression) {
				const res = traverse(element, localPath, pointer)
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