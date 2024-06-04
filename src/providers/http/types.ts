/**
 * @deprecated use HTTPProviderParamsV2
 * instead
 */
export type HTTPProviderParamsV1 = {
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
    body?: string// | Uint8Array
    /**
     * Whether to use ZK
     * @deprecated use pass empty 'responseRedactions' instead
     * to disable ZK
     * */
    useZK?: boolean
}