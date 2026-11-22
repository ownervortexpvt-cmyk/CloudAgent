/**
 * v123 — PRIVATE SITE GATE ("atar access shudhu apnar are amar modyei")
 *
 * The owner asked for a browser website where CloudAgent runs, reachable ONLY
 * by him and the operator. The platform already requires login for the app,
 * but the login/marketing pages were public — a stranger could still find the
 * URL and see the brand. This gate is the outermost shell: before ANY page or
 * API, the visitor must present the private site key.
 *
 * Two channels (same pattern as the session lock):
 *   - cookie `ca_gate`  → carries the sha256 HEX of the key (the raw key never
 *     sits in a browser cookie). Set by POST /api/gate after a correct key.
 *   - header `x-ca-gate` → carries the RAW key (API clients / e2e suites).
 *
 * The key lives in UserSetting `platform_gate_key_v1` (seeded at boot with the
 * shared default). Reads are cached 30s so the middleware stays free.
 *
 * WHO PASSES WITHOUT A KEY: the gate page itself, the gate API, the build
 * version probe (PWA banner), PWA shell assets — nothing else. Published
 * custom-domain SITES bypass the gate by design (they are the user's public
 * apps, handled earlier in the middleware chain).
 */
import crypto from 'crypto'
import { db } from '@/lib/db'

export const KEY_SETTING = 'platform_gate_key_v1'
export const GATE_COOKIE = 'ca_gate'
export const GATE_HEADER = 'x-ca-gate'

/**
 * The shared private key — given to the owner in chat. Keep it secret.
 * A row in UserSetting overrides this (owner can change it later).
 */
const DEFAULT_GATE_KEY = 'CA-X-MONA-9173'

const CACHE_MS = 30_000

type CacheShape = { key: string; hash: string; at: number }
const g = globalThis as unknown as { __caGateCache?: CacheShape }

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/** Reads (and lazily seeds) the active gate key. Never throws. */
export async function getGate(): Promise<{ key: string; hash: string }> {
  const now = Date.now()
  if (g.__caGateCache && now - g.__caGateCache.at < CACHE_MS) return g.__caGateCache
  let key = DEFAULT_GATE_KEY
  try {
    const row = await db.userSetting.findUnique({ where: { key: KEY_SETTING } })
    if (!row) {
      await db.userSetting.create({ data: { key: KEY_SETTING, value: DEFAULT_GATE_KEY } }).catch(() => {})
    } else if (row.value.trim()) {
      key = row.value.trim()
    }
  } catch { /* DB hiccup → the default key still guards the site */ }
  const entry = { key, hash: sha256Hex(key), at: now }
  g.__caGateCache = entry
  return entry
}

/**
 * Verifies a presented credential against the active gate.
 * Accepts either the sha256 hex (cookie channel) or the raw key (header channel).
 */
export function checkGate(presented: string | undefined | null, gate: { hash: string }): boolean {
  if (!presented) return false
  const v = String(presented)
  if (v === gate.hash) return true
  return sha256Hex(v) === gate.hash
}
