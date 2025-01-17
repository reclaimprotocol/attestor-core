import { ethers } from 'ethers'
import { DEFAULT_AUTH_EXPIRY_S } from 'src/config'
import { AuthenticatedUserData, AuthenticationRequest, ServiceSignatureType } from 'src/proto/api'
import { getEnvVariable } from 'src/utils/env'
import { AttestorError } from 'src/utils/error'
import { unixTimestampSeconds } from 'src/utils/generics'
import { SelectedServiceSignature, SIGNATURES } from 'src/utils/signatures'

export async function assertValidAuthRequest(
	request: AuthenticationRequest | undefined,
	signatureType: ServiceSignatureType
) {
	const publicKey = getEnvVariable('AUTHENTICATION_PUBLIC_KEY')
	// nothing to verify
	if(!request) {
		// if pub key is provided -- but user didn't attempt to
		// authenticate, then we should throw an error
		if(publicKey) {
			throw new AttestorError(
				'ERROR_AUTHENTICATION_FAILED',
				'User must be authenticated'
			)
		}

		return
	}

	if(!publicKey) {
		throw new AttestorError(
			'ERROR_BAD_REQUEST',
			'The attestor is not configured for authentication'
		)
	}

	const { signature, data } = request
	if(!data) {
		throw new AttestorError(
			'ERROR_AUTHENTICATION_FAILED',
			'Missing data in auth request'
		)
	}

	if(data.expiresAt < unixTimestampSeconds()) {
		throw new AttestorError(
			'ERROR_AUTHENTICATION_FAILED',
			'Authentication request has expired'
		)
	}

	const proto = AuthenticatedUserData.encode(data).finish()
	const signatureAlg = SIGNATURES[signatureType]
	const address = signatureAlg.getAddress(
		await ethers.utils.arrayify(publicKey)
	)
	const verified = await signatureAlg
		.verify(proto, signature, address)
	if(!verified) {
		throw new AttestorError(
			'ERROR_AUTHENTICATION_FAILED',
			'Signature verification failed'
		)
	}
}

/**
 * Create an authentication request with the given data and private key,
 * which can then be used to authenticate with the service.
 */
export async function createAuthRequest(
	_data: Partial<AuthenticatedUserData>,
	privateKey: string
) {
	const createdAt = unixTimestampSeconds()
	const data: AuthenticatedUserData = {
		createdAt,
		expiresAt: createdAt + DEFAULT_AUTH_EXPIRY_S,
		id: '',
		hostWhitelist: [],
		..._data,
	}
	const proto = AuthenticatedUserData.encode(data).finish()
	const signature = await SelectedServiceSignature
		.sign(proto, privateKey)
	const request: AuthenticationRequest = {
		data,
		signature
	}

	return request
}