/**
 * v123 — CUSTOM DOMAINS ("nijer domain e app chalabo")
 *
 * A user points their domain (e.g. shop.mybrand.in) at the platform, proves
 * ownership with a TXT record, and the platform then SERVES their app on that
 * host. Two halves live here:
 *
 *   1. verifyDns() — proves the user controls the domain:
 *        TXT  _ca-verify.<domain>  must contain the per-domain verify token
 *      (checked with node:dns against public resolvers — no new deps).
 *
 *   2. resolveSiteHost() — the middleware asks this on every request: is this
 *      Host header a VERIFIED custom domain? If yes, return which project/port
 *      to serve. Cached 30s; stopped projects get a fire-and-forget auto-start
 *      (max one attempt per 90s per project) so "always-live" sites come back
 *      on their own after a sandbox recycle.
 */
import dns from 'dns'
import crypto from 'crypto'
import { db } from '@/lib/db'

const CACHE_MS = 30_000
const AUTOSTART_COOLDOWN_MS = 90_000

export interface SiteHostHit { projectId: string; port: number; domain: string }

type CacheShape = {
  map: Map<string, SiteHostHit>
  at: number
  autoStarted: Map<string, number>
}
const g = globalThis as unknown as { __caSiteHosts?: CacheShape }

function cleanHost(raw: string | null | undefined): string {
  return String(raw || '').toLowerCase().split(':')[0].trim()
}

export const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

/** Is this Host header one of the builder's own internal hosts? */
export function isPlatformHost(host: string | null | undefined): boolean {
  const h = cleanHost(host)
  if (!h) return true
  if (h === 'localhost' || h === '0.0.0.0' || h.startsWith('127.') || h.startsWith('192.168.') || h.endsWith('.local')) return true
  return false
}

/** Host → { projectId, port } for VERIFIED custom domains (30s cache). */
export async function resolveSiteHost(host: string | null | undefined): Promise<SiteHostHit | null> {
  const h = cleanHost(host)
  if (!h || isPlatformHost(h)) return null
  const now = Date.now()
  if (!g.__caSiteHosts || now - g.__caSiteHosts.at > CACHE_MS) {
    const map = new Map<string, SiteHostHit>()
    try {
      const rows = await db.customDomain.findMany({
        where: { verified: true },
        select: { domain: true, projectId: true },
      })
      for (const r of rows) {
        const project = await db.project.findUnique({
          where: { id: r.projectId },
          select: { entryPort: true, status: true, deletedAt: true },
        }).catch(() => null)
        if (!project || project.deletedAt) continue
        map.set(r.domain, { projectId: r.projectId, port: project.entryPort || 0, domain: r.domain })
        // always-live: bring stopped sites back (best effort, throttled)
        if ((!project.entryPort || project.status !== 'running') && project.status !== 'building') {
          maybeAutoStart(r.projectId)
        }
      }
    } catch { /* DB hiccup → serve nothing this round */ }
    g.__caSiteHosts = { map, at: now, autoStarted: g.__caSiteHosts?.autoStarted || new Map() }
  }
  return g.__caSiteHosts.map.get(h) || null
}

function maybeAutoStart(projectId: string) {
  const cache = g.__caSiteHosts
  if (!cache) return
  const last = cache.autoStarted.get(projectId) || 0
  if (Date.now() - last < AUTOSTART_COOLDOWN_MS) return
  cache.autoStarted.set(projectId, Date.now())
  void (async () => {
    try {
      const { runtimeManager } = await import('@/lib/runtime')
      const res = await runtimeManager.start(projectId)
      console.log(`[custom-domain] auto-start ${projectId}: ${res.ok ? `port ${res.port}` : res.error?.slice(0, 120)}`)
      if (res.ok) g.__caSiteHosts!.at = 0 // force remap next request
    } catch (e) {
      console.log('[custom-domain] auto-start failed:', (e as any)?.message)
    }
  })()
}

export interface DnsVerifyResult { ok: boolean; method: 'txt' | 'none'; detail: string }

/**
 * Ownership proof: TXT _ca-verify.<domain> must contain the token.
 * Uses the system resolver with a public-DNS fallback. 8s budget — verification
 * is a user-pressed button, never a hot path.
 */
export async function verifyDns(domain: string, token: string): Promise<DnsVerifyResult> {
  const name = `_ca-verify.${domain}`
  const resolvers = ['8.8.8.8', '1.1.1.1'] // Google + Cloudflare public resolvers
  for (const server of resolvers) {
    const res = new dns.promises.Resolver({ timeout: 6000, tries: 1 })
    res.setServers([server])
    try {
      const records = await res.resolveTxt(name)
      const flat = records.map((chunks) => chunks.join(''))
      if (flat.some((v) => v.trim() === token.trim())) {
        return { ok: true, method: 'txt', detail: `TXT ${name} verified via ${server}` }
      }
      return { ok: false, method: 'txt', detail: `TXT ${name} found (${flat.length} record(s)) but none matches the token` }
    } catch { /* try next resolver */ }
  }
  return { ok: false, method: 'none', detail: `TXT record _ca-verify.${domain} not visible yet — DNS can take a few minutes to propagate. Set it and press Verify again.` }
}

export function newVerifyToken(): string {
  return `ca-verify-${crypto.randomBytes(8).toString('hex')}`
}
