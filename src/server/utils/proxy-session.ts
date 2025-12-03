export function isValidProxySessionId(sessionId: string): boolean {
    return typeof sessionId === 'string' && sessionId.length >= 8 && sessionId.length < 15 && /^[a-z0-9]+$/.test(sessionId);
}