// these patches are required to make "xpath" work with parse5
import { Element, Node } from 'domhandler'

Element.prototype.toString = function() {
	throw new Error('Element.toString() is not supported')
	// return ds(this)
}

Object.defineProperty(Node.prototype, 'nodeName', {
	get: function() {
		return this.name
	},
})

Object.defineProperty(Node.prototype, 'localName', {
	get: function() {
		return this.name
	},
})

const origAttributes = Object.getOwnPropertyDescriptor(
	Element.prototype,
	'attributes'
)?.get

if(origAttributes) {
	Object.defineProperty(Element.prototype, 'attributes', {
		get: function(...args) {
			// eslint-disable-next-line prefer-rest-params
			const attrs = origAttributes.call(this, ...args)
			attrs.item = (idx: number) => {
				const el = attrs[idx]
				return { ...el, nodeType: 2, localName: el.name }
			}

			return attrs
		},
	})
} else {
	console.warn(
		'[WARN] Unable to patch DOM: Element.attributes property descriptor not found'
	)
}

declare module 'xpath' {
	function parse(expr: string): {
		select(opts: unknown): Node[]
	}
}