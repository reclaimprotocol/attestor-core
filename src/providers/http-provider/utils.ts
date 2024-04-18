import {
	ArrayExpression,
	Expression,
	ExpressionStatement,
	ObjectExpression,
	parseScript,
	Property,
	Syntax
} from 'esprima-next'
import * as jsdom from 'jsdom'
import { JSONPath } from 'jsonpath-plus'
import { RE2 } from 're2-wasm-inline/lib/re2'
import { ArraySlice } from '../../types'
import { makeHttpResponseParser, REDACTION_CHAR_CODE } from '../../utils'
import { HeaderMap, HTTPProviderParams, HTTPProviderParamsV2 } from './types'

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
	} else {
		//a workaround to get exact html element contents
		const wrap = dom.createElement('div')
		wrap.appendChild(node.cloneNode(true))
		return wrap.innerHTML
	}
}

export function extractJSONValueIndex(json: string, jsonPath: string) {
	const pointers = JSONPath({
		path: jsonPath,
		json: JSON.parse(json),
		wrap: false,
		resultType: 'pointer',
		preventEval: true
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

export function buildHeaders(input: HeaderMap) {
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

			const chunkSize = chunks[i].toIndex - chunks[i].fromIndex

			if(pos >= chunkBodyStart && pos <= (chunkBodyStart + chunkSize)) {
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

export function normaliseParamsToV2(params: HTTPProviderParams): HTTPProviderParamsV2 {
	// is already v2
	if('responseMatches' in params) {
		return params
	}

	const matches: HTTPProviderParamsV2['responseMatches'] = []
	const redactions: HTTPProviderParamsV2['responseRedactions'] = []
	for(const rs of params.responseSelections) {
		// if there is any response selection,
		// map to a v2 response redaction

		if(params.useZK) {
			if((rs.xPath || rs.jsonPath)) {
				redactions.push({
					xPath: rs.xPath,
					jsonPath: rs.jsonPath,
				})
			} else if(rs.responseMatch) {
				// v1 only supported either a regex
				// redaction or a json/xpath redaction
				redactions.push({ regex: rs.responseMatch })
			}
		}

		if(rs.responseMatch) {
			matches.push({
				type: 'regex',
				value: rs.responseMatch
			})
		}
	}

	return {
		...params,
		responseMatches: matches,
		responseRedactions: redactions
	}
}

export function makeRegex(str: string) {
	return new RE2(str, 'sgiu')
}

const TEMPLATE_START_CHARCODE = '{'.charCodeAt(0)
const TEMPLATE_END_CHARCODE = '}'.charCodeAt(0)

/**
 * Try to match strings that contain templates like {{param}}
 * against redacted string that has *** instead of that param
 * @param param
 * @param str
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