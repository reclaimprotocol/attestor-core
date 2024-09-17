import { ErrorCode, ErrorData } from 'src/proto/api'

/**
 * Represents an error that can be thrown by the Attestor Core
 * or server. Provides a code, and optional data
 * to pass along with the error.
 */
export class AttestorError extends Error {

	readonly name = 'AttestorError'

	constructor(
		public code: keyof typeof ErrorCode,
		public message: string,
		public data?: { [_: string]: any }
	) {
		super(message)
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

	static fromError(err: Error) {
		if(err instanceof AttestorError) {
			return err
		}

		return new AttestorError(
			'ERROR_INTERNAL',
			err.message,
		)
	}

	static badRequest(message: string, data?: { [_: string]: any }) {
		return new AttestorError(
			'ERROR_BAD_REQUEST',
			message,
			data
		)
	}
}