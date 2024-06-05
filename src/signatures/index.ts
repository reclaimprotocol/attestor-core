import { ServiceSignatureType } from '../proto/api'
import { ServiceSignatureProvider } from '../types'
import { ETH_SIGNATURE_PROVIDER } from './eth'

export const SIGNATURES = {
	[ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH]: ETH_SIGNATURE_PROVIDER,
} as { [key in ServiceSignatureType]: ServiceSignatureProvider }

export const SelectedServiceSignatureType = ServiceSignatureType.SERVICE_SIGNATURE_TYPE_ETH

export const SelectedServiceSignature = SIGNATURES[SelectedServiceSignatureType]