import type * as _jsdom from 'jsdom'

declare global {
	interface Window {
		jsdom: typeof _jsdom
	}
}

export const JSDOM = window.jsdom.JSDOM