import { WitnessErrorCode, WitnessErrorData } from 'src/proto/api'

/**
 * Represents an error that can be thrown by the Witness SDK
 * or server. Provides a code, and optional data
 * to pass along with the error.
 */
export class WitnessError extends Error {

	readonly name = 'WitnessError'

	constructor(
		public code: keyof typeof WitnessErrorCode,
		public message: string,
		public data?: { [_: string]: any }
	) {
		super(message)
	}

	/**
	 * Encodes the error as a WitnessErrorData
	 * protobuf message
	 */
	toProto() {
		return WitnessErrorData.create({
			code: WitnessErrorCode[this.code],
			message: this.message,
			data: JSON.stringify(this.data)
		})
	}

	static fromProto(data = WitnessErrorData.fromJSON({})) {
		return new WitnessError(
			WitnessErrorCode[data.code] as keyof typeof WitnessErrorCode,
			data.message,
			data.data ? JSON.parse(data.data) : undefined
		)
	}

	static fromError(err: Error) {
		if(err instanceof WitnessError) {
			return err
		}

		return new WitnessError(
			'WITNESS_ERROR_INTERNAL',
			err.message,
		)
	}

	static badRequest(message: string, data?: { [_: string]: any }) {
		return new WitnessError(
			'WITNESS_ERROR_BAD_REQUEST',
			message,
			data
		)
	}
}