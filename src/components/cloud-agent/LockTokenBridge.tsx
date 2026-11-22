'use client'

import { useEffect } from 'react'
import { getLockToken, clearLockToken } from '@/lib/lock-client'

/**
 * v25.1 — LockTokenBridge (global, mounted once in the root layout).
 *
 * Why: inside the embedded preview panel the browser treats the builder as a
 * third-party context and DROPS the `ca_lock` session cookie — the owner
 * unlocks successfully, then bounces straight back to the lock screen on the
 * next navigation (observed live on Android: 9 successful unlocks in 26s).
 *
 * What it does (no UI):
 *  1. Patches window.fetch ONCE so every same-origin request automatically
 *     carries the saved session token in the `x-ca-lock` header. Custom
 *     headers are NOT subject to third-party cookie blocking, so this works
 *     everywhere the builder can be opened (top-level tab, iframe, PWA).
 *  2. Watches for 401s flagged `x-ca-lock-revoked` (session revoked, PIN
 *     rotated, "sign out everywhere else") and clears the dead token, so the
 *     next navigation lands on the lock screen instead of failing forever.
 *
 * The cookie channel is untouched — on normal top-level browsers it keeps
 * working exactly as before; this is a pure fallback layer.
 */
export default function LockTokenBridge() {
  useEffect(() => {
    const w = window as any
    if (w.__caLockBridgeInstalled) return
    w.__caLockBridgeInstalled = true

    const origFetch = window.fetch.bind(window)
    w.__caOrigFetch = origFetch

    window.fetch = async (input: any, init?: any) => {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || ''
        // same-origin API/RSC requests only — never touch cross-origin calls
        const isSameOrigin = url.startsWith('/') || url.startsWith(`${window.location.origin}/`)
        if (isSameOrigin) {
          const token = getLockToken()
          if (token) {
            const headers = new Headers(init?.headers || (input && typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined))
            if (!headers.has('x-ca-lock')) headers.set('x-ca-lock', token)
            const res = await origFetch(input, { ...init, headers })
            if (res && res.status === 401 && res.headers.get('x-ca-lock-revoked')) {
              clearLockToken() // token revoked server-side — drop it quietly
            }
            return res
          }
        }
      } catch { /* never break a request because of the bridge */ }
      return origFetch(input, init)
    }
  }, [])

  // Invisible marker — E2E can assert the bridge was served.
  return <div data-ca-token-bridge="1" style={{ display: 'none' }} aria-hidden="true" />
}
