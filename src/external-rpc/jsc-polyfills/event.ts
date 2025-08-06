// @ts-expect-error
export class EventPolyfill implements Event {

	type: string

	constructor(type: string, eventInitDict?: EventInit) {
		this.type = type
		Object.assign(this, eventInitDict)
	}
}

export class ErrorEventPolyfill extends EventPolyfill {}

export class CloseEventPolyfill extends EventPolyfill {}

export class MessageEventPolyfill extends EventPolyfill {}