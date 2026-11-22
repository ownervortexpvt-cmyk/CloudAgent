'use client'

/**
 * Admin control-room client helper (v113).
 *
 * The unlock token is kept in localStorage AND delivered as an httpOnly
 * cookie by the server. Every control-room request carries the token in the
 * `x-ca-admin` header too — the same embedded-safe dual channel the builder
 * session uses, so the panel also works inside cross-site preview iframes
 * where third-party cookies are dropped.
 */

const ADMIN_TOKEN_KEY = 'ca_admin_unlock_token'

export function saveAdminToken(token: string) {
  try {
    if (token && token.length > 8) localStorage.setItem(ADMIN_TOKEN_KEY, token)
  } catch { /* private mode — cookie channel still applies */ }
}

export function getAdminToken(): string | null {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) } catch { return null }
}

export function clearAdminToken() {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY) } catch {}
}

export class AdminApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** fetch that carries the unlock token and throws readable errors. */
export async function afetch(url: string, init?: RequestInit): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const t = getAdminToken()
  if (t) headers['x-ca-admin'] = t
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as any) }, credentials: 'include' })
  let data: any = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    throw new AdminApiError(data?.error || data?.error?.message || `HTTP ${res.status}`, res.status)
  }
  return data
}
