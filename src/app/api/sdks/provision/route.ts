import { NextRequest, NextResponse } from 'next/server'
import { getProvisionStatus, triggerProvisioning, healAllMissing, installOneToolchain, provisionLogTail } from '@/lib/provision'
import { requireProjectAccess, requireAdmin } from '@/lib/auth'

/**
 * v81 — Add-Storage provisioning status & control.
 *
 * GET  /api/sdks/provision[?projectId=x][&log=name:projectId]
 *        → every provisioning job (or one project's), live re-probed;
 *          ?log=<toolchain>:<projectId> returns the tail of a setup log.
 * POST /api/sdks/provision { projectId, language, source? }  → manual trigger
 *        for one project (the Retry button), or { healAll: true } → install
 *        every missing managed toolchain right now (no boot wait),
 *        or { install: '<name>' } → v94 one-click install of ONE managed
 *        toolchain (the SDK Manager grid button).
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || undefined
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const log = req.nextUrl.searchParams.get('log')
  if (log) {
    const [name, pid] = log.split(':')
    // BUSINESS v2 (hardened): provisioning logs are per-project — ownership check.
    if (pid) {
      try { await requireProjectAccess(req, pid) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
    }
    return NextResponse.json({ log: provisionLogTail(name, pid || '') })
  }
  return NextResponse.json({ jobs: getProvisionStatus(projectId) })
}

export async function POST(req: NextRequest) {
  let body: { projectId?: string; projectName?: string; language?: string; source?: 'manual' | 'heal-all'; healAll?: boolean; install?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // BUSINESS v2 (hardened): installing toolchains / healing all is a
  // system-wide operation — admins only. Per-project triggers below are
  // ownership-checked.
  if (body.install || body.healAll) { await requireAdmin(req).catch((e: any) => { throw e }) }
  // v94: install ONE managed toolchain by name (SDK Manager grid button)
  if (body.install) {
    const r = installOneToolchain(String(body.install).trim())
    return NextResponse.json({
      ok: true,
      started: r.started,
      item: r.item,
      message: r.started
        ? `installing ${r.item.name} in the background — poll GET /api/sdks for presence`
        : (r.item.detail || 'not started — see item detail'),
    })
  }

  if (body.healAll) {
    const r = healAllMissing()
    return NextResponse.json({ ok: true, ...r, message: r.started ? 'installing missing toolchains in the background — poll GET for progress' : 'nothing could be started (already ready or disk-blocked — see items)' })
  }

  if (!body.projectId || !body.language) {
    return NextResponse.json({ error: 'projectId and language required (or healAll: true)' }, { status: 400 })
  }
  // BUSINESS v2 (hardened): only the owner (or an admin) provisions this project.
  try { await requireProjectAccess(req, String(body.projectId)) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const r = triggerProvisioning({
    projectId: String(body.projectId),
    projectName: body.projectName ? String(body.projectName) : undefined,
    language: String(body.language),
    source: 'manual',
  })
  return NextResponse.json({ ok: true, ...r })
}
