type EventHandlerFn<T> = (data: T) => void

export class EventBus<T> {

	#listeners: EventHandlerFn<T>[] = []

	addListener(fn: EventHandlerFn<T>) {
		this.#listeners.push(fn)
		return () => {
			this.#listeners = this.#listeners.filter(l => l !== fn)
		}
	}

	dispatch(data: T) {
		for(const listener of this.#listeners) {
			listener(data)
		}
	}
}