/* eslint-disable */
/* Generated file. Do not edit */

type BinaryData = Uint8Array | string

export interface HttpProviderParameters {
  /**
   * which URL does the request have to be made to Has to be a valid https URL for eg. https://amazon.in/orders?q=abcd
   */
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  /**
   * Specify the geographical location from where to proxy the request. 2-letter ISO country code
   */
  geoLocation?: string;
  /**
   * Any additional headers to be sent with the request Note: these will be revealed to the attestor & won't be redacted from the transcript. To add hidden headers, use 'secretParams.headers' instead
   */
  headers?: {
    [k: string]: string;
  };
  /**
   * Body of the HTTP request
   */
  body?: BinaryData;
  /**
   * If the API doesn't perform well with the "key-update" method of redaction, you can switch to "zk" mode by setting this to "zk"
   */
  writeRedactionMode?: "zk" | "key-update";
  /**
   * Apply TLS configuration when creating the tunnel to the attestor.
   */
  additionalClientOptions?: {
    /**
     * @minItems 1
     */
    supportedProtocolVersions?: ("TLS1_2" | "TLS1_3")[];
  };
  /**
   * The attestor will use this list to check that the redacted response does indeed match all the provided strings/regexes
   *
   * @minItems 1
   */
  responseMatches: {
    /**
     * "regex": the response must match the regex "contains": the response must contain the provided
     *  string exactly
     */
    value: string;
    /**
     * The string/regex to match against
     */
    type: "regex" | "contains";
    /**
     * Inverses the matching logic. Fail when match is found and proceed otherwise
     */
    invert?: boolean;
  }[];
  /**
   * which portions to select from a response. These are selected in order, xpath => jsonPath => regex * These redactions are done client side and only the selected portions are sent to the attestor. The attestor will only be able to see the selected portions alongside the first line of the HTTP response (i.e. "HTTP/1.1 200 OK") * To disable any redactions, pass an empty array
   */
  responseRedactions?: {
    /**
     * expect an HTML response, and to contain a certain xpath for eg. "/html/body/div.a1/div.a2/span.a5"
     */
    xPath?: string;
    /**
     * expect a JSON response, retrieve the item at this path using dot notation for e.g. 'email.addresses.0'
     */
    jsonPath?: string;
    /**
     * select a regex match from the response
     */
    regex?: string;
  }[];
  /**
   * A map of parameter values which are user in form of {{param}} in URL, responseMatches, responseRedactions, body, geolocation. Those in URL, responseMatches & geo will be put into context and signed This value will NOT be included in provider hash
   */
  paramValues?: {
    [k: string]: string;
  };
}

export const HttpProviderParametersJson = {"title":"HttpProviderParameters","type":"object","required":["url","method","responseMatches"],"properties":{"url":{"type":"string","format":"url","description":"which URL does the request have to be made to Has to be a valid https URL for eg. https://amazon.in/orders?q=abcd"},"method":{"type":"string","enum":["GET","POST","PUT","PATCH"]},"geoLocation":{"type":"string","nullable":true,"pattern":"^[A-Za-z]{0,2}$","description":"Specify the geographical location from where to proxy the request. 2-letter ISO country code"},"headers":{"type":"object","description":"Any additional headers to be sent with the request Note: these will be revealed to the attestor & won't be redacted from the transcript. To add hidden headers, use 'secretParams.headers' instead","additionalProperties":{"type":"string"}},"body":{"description":"Body of the HTTP request","oneOf":[{"type":"string","format":"binary"},{"type":"string"}]},"writeRedactionMode":{"type":"string","description":"If the API doesn't perform well with the \"key-update\" method of redaction, you can switch to \"zk\" mode by setting this to \"zk\"","enum":["zk","key-update"]},"additionalClientOptions":{"type":"object","description":"Apply TLS configuration when creating the tunnel to the attestor.","nullable":true,"properties":{"supportedProtocolVersions":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","enum":["TLS1_2","TLS1_3"]}}}},"responseMatches":{"type":"array","minItems":1,"uniqueItems":true,"description":"The attestor will use this list to check that the redacted response does indeed match all the provided strings/regexes","items":{"type":"object","required":["value","type"],"properties":{"value":{"type":"string","description":"\"regex\": the response must match the regex \"contains\": the response must contain the provided\n string exactly"},"type":{"type":"string","description":"The string/regex to match against","enum":["regex","contains"]},"invert":{"type":"boolean","description":"Inverses the matching logic. Fail when match is found and proceed otherwise"}},"additionalProperties":false}},"responseRedactions":{"type":"array","uniqueItems":true,"description":"which portions to select from a response. These are selected in order, xpath => jsonPath => regex * These redactions are done client side and only the selected portions are sent to the attestor. The attestor will only be able to see the selected portions alongside the first line of the HTTP response (i.e. \"HTTP/1.1 200 OK\") * To disable any redactions, pass an empty array","items":{"type":"object","properties":{"xPath":{"type":"string","nullable":true,"description":"expect an HTML response, and to contain a certain xpath for eg. \"/html/body/div.a1/div.a2/span.a5\""},"jsonPath":{"type":"string","nullable":true,"description":"expect a JSON response, retrieve the item at this path using dot notation for e.g. 'email.addresses.0'"},"regex":{"type":"string","nullable":true,"description":"select a regex match from the response"}},"additionalProperties":false}},"paramValues":{"type":"object","description":"A map of parameter values which are user in form of {{param}} in URL, responseMatches, responseRedactions, body, geolocation. Those in URL, responseMatches & geo will be put into context and signed This value will NOT be included in provider hash","additionalProperties":{"type":"string"}}},"additionalProperties":false}
/**
 * Secret parameters to be used with HTTP provider. None of the values in this object will be shown to the attestor
 */
export interface HttpProviderSecretParameters {
  /**
   * cookie string for authorisation.
   */
  cookieStr?: string;
  /**
   * authorisation header value
   */
  authorisationHeader?: string;
  /**
   * Headers that need to be hidden from the attestor
   */
  headers?: {
    [k: string]: string;
  };
  /**
   * A map of parameter values which are user in form of {{param}} in body these parameters will NOT be shown to attestor and extracted
   */
  paramValues?: {
    [k: string]: string;
  };
}

export const HttpProviderSecretParametersJson = {"title":"HttpProviderSecretParameters","type":"object","description":"Secret parameters to be used with HTTP provider. None of the values in this object will be shown to the attestor","properties":{"cookieStr":{"type":"string","description":"cookie string for authorisation."},"authorisationHeader":{"type":"string","description":"authorisation header value"},"headers":{"type":"object","description":"Headers that need to be hidden from the attestor","additionalProperties":{"type":"string"}},"paramValues":{"type":"object","description":"A map of parameter values which are user in form of {{param}} in body these parameters will NOT be shown to attestor and extracted","additionalProperties":{"type":"string"}}},"additionalProperties":false}
export interface ProvidersConfig {
	http: {
		parameters: HttpProviderParameters
		secretParameters: HttpProviderSecretParameters
	}
}

export const PROVIDER_SCHEMAS = {
	http: {
		parameters: HttpProviderParametersJson,
		secretParameters: HttpProviderSecretParametersJson
	},
}
