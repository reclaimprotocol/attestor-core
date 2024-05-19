import { Logger } from '../types'

export const logger = makeLogger({ })

function jsonLog(level: keyof typeof logger, opts: { [_: string]: any } | undefined, ...data: any[]) {
	if(opts) {
		data.unshift(opts)
	}

	return console[level](...data)
}

function makeLogger(opts?: { [_: string]: any }): Logger {
	if(!Object.keys(opts || {})) {
		opts = undefined
	}

	return {
		debug: (...data) => jsonLog('debug', opts, ...data),
		info: (...data) => jsonLog('info', opts, ...data),
		warn: (...data) => jsonLog('warn', opts, ...data),
		error: (...data) => jsonLog('error', opts, ...data),
		// trace logging off by default
		trace: () => {},
		child: opts2 => makeLogger({ ...opts, ...opts2 }),
	}
}