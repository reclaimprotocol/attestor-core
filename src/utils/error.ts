import { ErrorCode, ErrorData } from '#src/proto/api.ts'

/**
 * Represents an error that can be thrown by the Attestor Core
 * or server. Provides a code, and optional data
 * to pass along with the error.
 */
export class AttestorError extends Error {

	readonly name = 'AttestorError'
	readonly code: keyof typeof ErrorCode
	readonly data: { [_: string]: any } | undefined

	constructor(
		code: keyof typeof ErrorCode,
		message: string,
		data?: { [_: string]: any }
	) {
		super(message)
		this.code = code
		this.data = data
	}

	/**
	 * Encodes the error as a ErrorData
	 * protobuf message
	 */
	toProto() {
		return ErrorData.create({
			code: ErrorCode[this.code],
			message: this.message,
			data: JSON.stringify(this.data)
		})
	}

	static fromProto(data = ErrorData.fromJSON({})) {
		return new AttestorError(
			ErrorCode[data.code] as keyof typeof ErrorCode,
			data.message,
			data.data ? JSON.parse(data.data) : undefined
		)
	}

	static fromError(
		err: Error,
		code: keyof typeof ErrorCode = 'ERROR_INTERNAL'
	) {
		if(err instanceof AttestorError) {
			return err
		}

		return new AttestorError(code, err.message)
	}

	static badRequest(message: string, data?: { [_: string]: any }) {
		return new AttestorError(
			'ERROR_BAD_REQUEST',
			message,
			data
		)
	}
}