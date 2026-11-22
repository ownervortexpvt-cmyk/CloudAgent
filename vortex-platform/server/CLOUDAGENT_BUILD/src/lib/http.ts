/**
 * v75 — client-side hardening for API fetches (fixes
 * "Unexpected token '<', "<html> <h"... is not valid JSON").
 *
 * ROOT CAUSE: when the Next.js dev server is restarting / briefly unreachable,
 * the gateway answers an API fetch with an HTML error page (502/504 —
 * "<html><head><title>…"). The old code called `await res.json()` directly, so
 * the JSON parser choked on the first `<` and the owner saw the cryptic token
 * error instead of an honest "server is waking up" message.
 *
 * `readApi` checks the Content-Type BEFORE parsing and converts non-JSON
 * responses (gateway pages, lock-screen HTML, proxy errors) into readable
 * Error messages. Use it everywhere a fetch is expected to return JSON.
 */

export async function readApi<T = unknown>(res: Response): Promise<T> {
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (!ct.includes('json')) {
    let hint = ''
    try {
      hint = (await res.text())
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140)
    } catch { /* body unreadable — fine */ }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(
        `Server temporarily unreachable (HTTP ${res.status}) — it is probably restarting. Wait a few seconds and press Run again.`,
      )
    }
    throw new Error(
      `Server returned a non-JSON response (HTTP ${res.status}${ct ? `, ${ct.split(';')[0]}` : ''}). ${hint}`.trim(),
    )
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new Error('Server sent a malformed JSON response — try again in a moment.')
  }
}

/** Convenience: fetch + readApi in one call. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  return readApi<T>(res)
}
