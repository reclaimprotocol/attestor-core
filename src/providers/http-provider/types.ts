import { RedactionMode } from '../../types'

type HTTPProviderParamsV1 = {
    /**
     * Any additional headers to be sent with the request
     * Note: these will be revealed to the witness & won't be
     * redacted from the transcript
     */
    headers?: Record<string, string>
    /**
     * which URL does the request have to be made to
     * for eg. https://amazon.in/orders?q=abcd
     */
    url: string
    /** HTTP method */
    method: 'GET' | 'POST'
    /** which portions to select from a response.
     * If both are set, then JSON path is taken after xPath is found
     * @deprecated use 'responseRedactions' instead
     * */
    responseSelections: {
        /**
         * expect an HTML response, and to contain a certain xpath
         * for eg. "/html/body/div.a1/div.a2/span.a5"
         */
        xPath?: string
        /**
         * expect a JSON response, retrieve the item at this path
         * using dot notation
         * for e.g. 'email.addresses.0'
         */
        jsonPath?: string
        /** A regexp to match the "responseSelection" to */
        responseMatch: string
    }[]
    /**
     * The body of the request.
     * Only used if method is POST
     */
    body?: string | Uint8Array
    /**
     * Whether to use ZK
     * @deprecated use pass empty 'responseRedactions' instead
     * to disable ZK
     * */
    useZK?: boolean
}

export type HeaderMap = { [key: string]: string }

export type HTTPProviderParamsV2 = {
    /**
     * Any additional headers to be sent with the request
     * Note: these will be revealed to the witness & won't be
     * redacted from the transcript. To add hidden headers,
     * use 'secretParams.headers' instead
     */
    headers?: HeaderMap
    /**
     * which URL does the request have to be made to
     * for eg. https://amazon.in/orders?q=abcd
     */
    url: string
    /** HTTP method */
    method: 'GET' | 'POST'
    /**
     * The body of the request.
     * Only used if method is POST
     */
    body?: string | Uint8Array
    /**
     * which portions to select from a response.
     * These are selected in order, xpath => jsonPath => regex
     *
     * These redactions are done client side and only the selected
     * portions are sent to the witness. The witness will only be able
     * to see the selected portions alongside the first line of the HTTP
     * response (i.e. "HTTP/1.1 200 OK")
     *
     * To disable any redactions, pass an empty array
     * */
    responseRedactions: {
        /**
         * expect an HTML response, and to contain a certain xpath
         * for eg. "/html/body/div.a1/div.a2/span.a5"
         */
        xPath?: string
        /**
         * expect a JSON response, retrieve the item at this path
         * using dot notation
         * for e.g. 'email.addresses.0'
         */
        jsonPath?: string
        /**
         * select a regex match from the response
         */
        regex?: string
    }[]
    /**
     * The witness will use this list to check
     * that the redacted response does indeed match
     * all the provided strings/regexes
     */
    responseMatches: {
        /**
         * "regex": the response must match the regex
         * "contains": the response must contain the provided
         *  string exactly
         */
        type: 'regex' | 'contains'
        /**
         * The string/regex to match against
         */
        value: string

        /**
         * Inverses the matching logic.
         * Fail when match is found and proceed otherwise
         */
        invert?: boolean
    }[]

    /**
     * Specify the geographical location from where
     * to proxy the request
     */
    geoLocation?: string

    writeRedactionMode?: RedactionMode

    /**
     * A map of parameter values which are user in form of {{param}} in URL, responseMatches, responseRedactions,
     * body, geolocation.
     * Those in URL, responseMatches & geo will be put into context and signed
     */
    paramValues?: { [_: string]: string }
}

export type HTTPProviderParams = HTTPProviderParamsV1
    | HTTPProviderParamsV2

export type HTTPProviderSecretParams = {
    /** cookie string for authorisation. Will be redacted from witness */
    cookieStr?: string
    /** authorisation header value. Will be redacted from witness */
    authorisationHeader?: string
    /**
     * Headers that need to be hidden from the witness
     */
    headers?: HeaderMap

    /**
     * A map of parameter values which are user in form of {{param}} in body
     * these parameters will NOT be shown to witness and extracted
     */
    paramValues?: { [_: string]: string }
}

export const paramsV2Schema = {
	'$schema': 'http://json-schema.org/draft-07/schema#',
	'title': 'HTTP Provider params schema',
	'type': 'object',
	'properties': {
		'geoLocation': { 'type': 'string', nullable: true },
		'headers': {
			'type': 'object',
			'additionalProperties': { 'type': 'string' }
		},
		'url': { 'type': 'string' },
		'method': { 'type': 'string', 'enum': ['GET', 'POST'] },
		'body': { 'type': 'string', nullable: true },
		'writeRedactionMode': { 'type': 'string', 'enum': ['zk', 'key-update'] },
		'useZK': { 'type': 'boolean' },
		'responseSelections': {
			'type': 'array',
			'minItems': 1,
			'uniqueItems': true,
			'items': {
				'type': 'object',
				'properties': {
					'xPath': { 'type': 'string', nullable: true },
					'jsonPath': { 'type': 'string', nullable: true },
					'responseMatch': { 'type': 'string' }
				},
				'required': [
					'responseMatch'
				],
				'additionalProperties': false
			}
		},
		'responseMatches': {
			'type': 'array',
			'minItems': 1,
			'uniqueItems': true,
			'items': {
				'type': 'object',
				'properties': {
					'value': { 'type': 'string' },
					'type': { 'type': 'string', 'enum': ['regex', 'contains'] },
					'invert': { 'type': 'boolean' }
				},
				'required': [
					'value',
					'type'
				],
				'additionalProperties': false
			}
		},
		'responseRedactions': {
			'type': 'array',
			'items': {
				'type': 'object',
				'properties': {
					'xPath': { 'type': 'string', nullable: true },
					'jsonPath': { 'type': 'string', nullable: true },
					'regex': { 'type': 'string', nullable: true }
				},
				'anyOf': [
					{ 'required': ['xPath'] },
					{ 'required': ['jsonPath'] },
					{ 'required': ['regex'] },
				],
				'additionalProperties': false
			}
		},
		'paramValues': {
			'type': 'object',
			'additionalProperties': { 'type': 'string' }
		}
	},
	'oneOf': [
		{ 'required': ['responseMatches'] },
		{ 'required': ['responseSelections'] }
	],
	'required': [
		'url',
		'method'
	],
	'additionalProperties': false
}