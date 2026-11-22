'use client'

/**
 * v25.1 — embedded-safe lock token helpers (browser side).
 *
 * The session cookie can be dropped by browsers when the builder runs inside
 * a cross-site preview iframe (third-party cookie blocking). The signed
 * session token is therefore ALSO kept in localStorage and attached to every
 * same-origin API request as the `x-ca-lock` header by LockTokenBridge.
 * Server-side, both channels verify identically (HMAC + live session
 * registry), so revocation, PIN rotation and "sign out everywhere else"
 * keep working exactly as before.
 */

export const LOCK_TOKEN_KEY = 'ca_lock_token'

export function saveLockToken(token: string) {
  try {
    if (token && token.length > 8) localStorage.setItem(LOCK_TOKEN_KEY, token)
  } catch { /* private mode — cookie channel still applies */ }
}

export function getLockToken(): string | null {
  try {
    return localStorage.getItem(LOCK_TOKEN_KEY)
  } catch {
    return null
  }
}

export function clearLockToken() {
  try {
    localStorage.removeItem(LOCK_TOKEN_KEY)
  } catch { /* ignore */ }
}
