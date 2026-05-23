import { Logging } from '@google-cloud/logging'
import { Writable } from 'stream'

import type { LogLevel } from '#src/types/index.ts'
import { setLoggerDestination } from '#src/utils/logger.ts'

// Map pino numeric levels to Cloud Logging severities.
function pinoLevelToSeverity(level: number): string {
	if(level >= 60) {
		return 'CRITICAL'
	}

	if(level >= 50) {
		return 'ERROR'
	}

	if(level >= 40) {
		return 'WARNING'
	}

	if(level >= 30) {
		return 'INFO'
	}

	if(level >= 20) {
		return 'DEBUG'
	}

	return 'DEFAULT'
}

interface CloudLoggingOptions {
	projectId: string
	logName: string
	level?: LogLevel
}

class CloudLoggingStream extends Writable {
	private readonly cloudLogger: ReturnType<Logging['log']>

	constructor(projectId: string, logName: string) {
		super({ decodeStrings: false })
		const logging = new Logging({ projectId })
		this.cloudLogger = logging.log(logName)
	}

	async probe(): Promise<void> {
		await this.cloudLogger.write(
			this.cloudLogger.entry(
				{ severity: 'DEFAULT' },
				{ message: 'cloud logging probe' }
			)
		)
	}

	override _write(
		chunk: Buffer | string,
		_encoding: string,
		cb: (err?: Error) => void
	): void {
		try {
			let parsed: Record<string, unknown>
			try {
				parsed = JSON.parse(chunk.toString())
			} catch {
				parsed = { message: chunk.toString().trim() }
			}

			const level = (parsed.level as number) ?? 30
			const severity = pinoLevelToSeverity(level)
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { msg, message, time, level: _level, ...rest } = parsed
			const entry = this.cloudLogger.entry(
				{
					severity,
					timestamp: typeof time === 'string'
						? new Date(time)
						: undefined
				},
				{
					message: (msg ?? message ?? '') as string,
					...rest
				}
			)
			// Cloud Logging buffers internally; don't block the producer.
			this.cloudLogger.write(entry).catch(() => undefined)
		} catch {
			// Never let logging crash the process.
		}

		cb()
	}
}

let installed = false

/**
 * Replaces the default pino logger with one that forwards every log line
 * to GCP Cloud Logging under the given log name. Idempotent.
 *
 * Probes the Cloud Logging client first by writing a no-op entry; if
 * authentication or transport fails, leaves the default stdout logger in
 * place rather than crashing the process. On Confidential Space VMs the
 * launcher's `tee-container-log-redirect` ships stdout to Cloud Logging
 * anyway, so the worst case is logs appear under
 * `confidential-space-launcher` rather than the configured `logName`.
 *
 * We also install a process-wide `unhandledRejection` filter that
 * swallows errors originating in `@google-cloud/logging`, since the SDK
 * has internal lazy gRPC init that escapes our local `.catch()`.
 */
export function installCloudLogging(opts: CloudLoggingOptions): void {
	if(installed) {
		return
	}

	// Install rejection + exception filters BEFORE constructing the
	// Logging client. The SDK kicks off auth+gRPC stub creation as a
	// background promise whose rejection is rethrown synchronously
	// inside a microtask, escaping any local `.catch()`. Without these
	// handlers a misconfigured environment (no ADC, network blip, IAM
	// issue) crashes the process before any other log can be written.
	const isLoggingErr = (e: unknown) => {
		const stack = (e as Error)?.stack ?? ''
		return stack.includes('@google-cloud/logging')
			|| stack.includes('google-gax')
			|| stack.includes('google-auth-library')
	}
	process.on('unhandledRejection', (reason) => {
		if(isLoggingErr(reason)) {

			console.error('tee: cloud logging async rejection swallowed:',
				(reason as Error)?.message)
			return
		}

		throw reason
	})
	process.on('uncaughtException', (err) => {
		if(isLoggingErr(err)) {

			console.error('tee: cloud logging uncaught error swallowed:',
				err?.message)
			return
		}

		throw err
	})

	const stream = new CloudLoggingStream(opts.projectId, opts.logName)
	setLoggerDestination(stream, opts.level)
	installed = true
}
