import {
	ArrayExpression,
	Expression,
	ExpressionStatement,
	ObjectExpression,
	parseScript,
	Property,
	Syntax,
} from 'esprima-next'
import * as jsdom from 'jsdom'
import { JSONPath } from 'jsonpath-plus'
import {makeHttpResponseParser} from "../../utils";
import {ArraySlice} from "../../types";

export type JSONIndex = {
	start: number
	end: number
}

// utilise JSDom on NodeJS, otherwise
// use the browser's window object
const Window = typeof window !== 'undefined'
	? window
	: new jsdom.JSDOM().window

export function extractHTMLElement(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): string {
	const domParser = new Window.DOMParser()
	const dom = domParser.parseFromString(html, 'text/html')
	const node = dom
		.evaluate(xpathExpression, dom, null, Window.XPathResult.FIRST_ORDERED_NODE_TYPE, null)
		?.singleNodeValue
	if(!node) {
		return 'Element not found'
	}

	if(contentsOnly) {
		return node.textContent!
	}

	const xmlSerializer = new Window.XMLSerializer()
	return xmlSerializer
		.serializeToString(node)
		.replace(/ xmlns="[^"]+"/, '')
}

export function extractJSONValueIndex(json: string, jsonPath: string) {
	const pointers = JSONPath({
		path: jsonPath,
		json: JSON.parse(json),
		wrap: false,
		resultType: 'pointer',
	})
	if(!pointers) {
		throw new Error('jsonPath not found')
	}

	const tree = parseScript('(' + json + ')', { range: true }) //wrap in parentheses for esprima to parse
	if(tree.body[0] instanceof ExpressionStatement) {
		if(tree.body[0].expression instanceof ObjectExpression) {
			const index = traverse(tree.body[0].expression, '', pointers)
			if(index) {
				return {
					start: index.start - 1, //account for '('
					end: index.end - 1,
				}
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

export function buildHeaders(input: Record<string, string>) {
	const headers: string[] = []

	for(const [key, value] of Object.entries(input)) {
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
		for(let i = 0; i < chunks.length; i++) {

			const chunkSize = chunks[i].toIndex-chunks[i].fromIndex

			if(pos >= chunkBodyStart && pos < (chunkBodyStart+chunkSize)) {
				return pos - chunkBodyStart + chunks[i].fromIndex
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