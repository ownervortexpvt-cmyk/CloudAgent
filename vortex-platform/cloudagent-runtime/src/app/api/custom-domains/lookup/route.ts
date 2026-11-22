/**
 * v67 — Custom-domain routing lookup (PUBLIC, no lock).
 *
 * WHY THIS EXISTS: the external gateway that fronts the builder calls
 * /api/custom-domains/lookup to decide how to route live URLs. The path was
 * allowlisted in LOCK_PUBLIC_PATHS since the lock was introduced, but the
 * route file itself NEVER existed — every gateway call answered 404. This is
 * the missing half: a small, honest, data-leak-free endpoint.
 *
 * Contract (GET):
 *   ?host=shop.example.com   (also accepts ?domain= — same thing)
 *   → { ok: true, host, mapped: false, reason }   today, because the builder
 *     does not yet persist custom-domain claims anywhere. When domain claims
 *     get a real model, this route is the single place to extend.
 *
 * It deliberately returns NO owner data (no project names, no counts) — the
 * endpoint is reachable without the lock, so it must stay leak-free.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get('host') || req.nextUrl.searchParams.get('domain') || '')
    .toLowerCase()
    .trim()
    .slice(0, 253)

  // Malformed host → still 200 with a well-formed payload (the gateway
  // treats 4xx/5xx as "lookup service broken" and may take the URL down).
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    return NextResponse.json({ ok: true, host: host || null, mapped: false, reason: 'invalid host parameter' })
  }

  // v123 — real claims now EXIST. A VERIFIED domain maps to its project's
  // preview (the middleware serves it on the same origin); pending/error
  // domains stay unmapped with an honest reason.
  try {
    const { resolveSiteHost } = await import('@/lib/custom-domains')
    const hit = await resolveSiteHost(host)
    if (hit && hit.port) {
      return NextResponse.json({
        ok: true,
        host,
        mapped: true,
        projectId: hit.projectId,
        serve: `/preview/${hit.port}/`,
      })
    }
  } catch { /* fall through to the honest unmapped answer */ }

  const claimed = await db.customDomain.findUnique({ where: { domain: host } }).catch(() => null)
  if (claimed) {
    return NextResponse.json({
      ok: true,
      host,
      mapped: false,
      reason: claimed.verified
        ? 'verified but the project is not serving yet — try again in a minute'
        : 'domain claimed but ownership is NOT verified yet — publish the TXT _ca-verify record, then press Verify',
    })
  }

  return NextResponse.json({
    ok: true,
    host,
    mapped: false,
    reason: 'this host is not claimed on this builder — add it under Publish → Custom Domain',
  })
}
