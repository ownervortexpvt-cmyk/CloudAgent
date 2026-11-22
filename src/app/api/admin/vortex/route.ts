/**
 * v149 — VORTEX ECOSYSTEM CONTROL (admin control room).
 *
 * Owner request: "ভোর্টেক্স সার্ভার + ভোর্টেক্স ওয়েবসাইট ক্লাউড এজেন্টের ভিতরে
 * থাকবে — আমি ক্লাউড এজেন্ট দিয়েই আপডেট করব". Both components already run
 * inside the agent's boot tree (watchdog child, :3200); this route gives the
 * control room the levers:
 *
 *   GET                 → live status: :3200 probe + version, VORTEX website
 *                         mirror (self-host store), VORTEX hosting on :3200,
 *                         CloudAgent BUILD_ID. Auto-seeds the mirror when
 *                         missing (self-heal after a db wipe).
 *   POST {action}:
 *     'update-website'  → re-sync the VORTEX website bundle from
 *                         vortex-platform/website/vortex-website/ to BOTH
 *                         the CloudAgent mirror (/sites/vortex-website/) and
 *                         the VORTEX server hosting (:3200).
 *     'restart-server'  → kill the :3200 process; the watchdog restarts it
 *                         within its normal probe cycle (~40-70s).
 *
 * Double-gated: admin session AND control-room PIN (requireAdminUnlocked) —
 * the same discipline as payments/providers/users.
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { getSite, listSites } from '@/lib/selfhost'
import { syncVortexWebsite, ensureVortexWebsiteMirror, VORTEX_MIRROR_SLUG } from '@/lib/vortex/website-sync'

const BASE = process.env.PROJECT_ROOT || '/home/z/my-project'

async function caBuildId(): Promise<string> {
  try { return fs.readFileSync(path.join(BASE, '.next', 'BUILD_ID'), 'utf8').trim() } catch { return 'dev' }
}

async function probeVortex(): Promise<{ online: boolean; version?: string; registryOnline?: number }> {
  try {
    const r = await fetch('http://127.0.0.1:3200/api/gw/status', { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return { online: false }
    const j: any = await r.json().catch(() => ({}))
    return {
      online: true,
      version: j?.data?.payload?.version,
      registryOnline: j?.data?.payload?.registry?.online,
    }
  } catch {
    return { online: false }
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  // self-heal: mirror missing (fresh db) → rebuild it right now
  let seeded: string | null = null
  if (!getSite(VORTEX_MIRROR_SLUG)) {
    const r = await ensureVortexWebsiteMirror().catch(() => null)
    if (r?.ok) seeded = `mirror seeded at v${r.mirror?.version}`
  }

  const mirror = getSite(VORTEX_MIRROR_SLUG)
  const vx = await probeVortex()
  return NextResponse.json({
    ok: true,
    cloudAgent: { buildId: await caBuildId() },
    vortexServer: { online: vx.online, version: vx.version, registryOnline: vx.registryOnline ?? null, port: 3200 },
    vortexWebsite: {
      mirror: mirror
        ? { live: true, version: mirror.activeVersion, files: mirror.lastFiles, bytes: mirror.lastBytes, url: '/sites/vortex-website/', updatedAt: mirror.updatedAt }
        : { live: false },
      reserved: true,
    },
    selfHostSites: listSites().map((s) => ({
      siteId: s.siteId, name: s.name, version: s.activeVersion, files: s.lastFiles,
      bytes: s.lastBytes, updatedAt: s.updatedAt, system: Boolean(s.system), url: `/sites/${s.siteId}/`,
    })),
    seeded,
  })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')

  if (action === 'update-website') {
    const r = await syncVortexWebsite()
    return NextResponse.json({ ...r, ok: r.ok }, { status: r.ok ? 200 : 502 })
  }

  if (action === 'restart-server') {
    // kill by PORT (the standalone renames its process title, so name-based
    // pkill misses it — same lesson the watchdog learned in v140)
    let killed = 0
    try {
      const { execSync } = await import('child_process')
      const out = execSync("ss -tlnp 2>/dev/null | grep ':3200 ' | grep -oE 'pid=[0-9]+' || true").toString()
      for (const m of out.matchAll(/pid=(\d+)/g)) {
        try { process.kill(Number(m[1]), 'SIGTERM'); killed++ } catch { /* already dead */ }
      }
    } catch { /* ss unavailable or already dead */ }
    return NextResponse.json({
      ok: true,
      killed,
      note: killed
        ? `VORTEX server stopped (${killed} process). The watchdog restarts it automatically within ~40-70s — poll GET for online:true.`
        : 'No VORTEX server process found on :3200 — the watchdog will start it within ~40-70s.',
    })
  }

  return NextResponse.json({ ok: false, error: `unknown action: ${action || '(none)'}. Use 'update-website' or 'restart-server'.` }, { status: 400 })
}
