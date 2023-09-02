import {
	ArrayExpression,
	Expression,
	ExpressionStatement,
	ObjectExpression,
	parseScript,
	Property,
	Syntax,
} from 'esprima-next'
import { parse } from 'parse5'
import { DOMParser } from 'xmldom'
import { serializeToString } from 'xmlserializer'
import * as xpath from 'xpath'

export type JSONIndex = {
	start: number
	end: number
}

export function extractHTMLElement(
	html: string,
	xpathExpression: string,
	contentsOnly: boolean
): string {
	const parser = new DOMParser()
	const document = parse(html.toString())
	const xhtml = serializeToString(document)
	const dom = parser.parseFromString(xhtml)

	const namespaces = {
		xhtml: 'http://www.w3.org/1999/xhtml',
	}

	// Create a namespace-aware select function
	const select = xpath.useNamespaces(namespaces)

	// Update the XPath expression to include the namespace prefix
	xpathExpression = xpathExpression.replace(/(^|\/)(\w+)/g, '$1xhtml:$2')
	const node = select(xpathExpression, dom, true)

	if(node) {
		if(contentsOnly) {
			return (node as Node).textContent!
		}

		return serializeToString(node).replace(/ xmlns="[^"]+"/, '')
	} else {
		return 'Element not found'
	}
}

export function extractJSONValueIndex(json: string, jsonPath: string) {
	const { JSONPath } = require('jsonpath-plus')
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
