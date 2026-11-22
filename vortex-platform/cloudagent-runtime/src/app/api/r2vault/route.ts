import { NextRequest, NextResponse } from 'next/server'
import { isUnlockedRequest } from '@/lib/lock'
import { requireAdmin } from '@/lib/auth'
import { localFreeMb } from '@/lib/disk'
import {
  getR2StatusInput, saveR2Config, saveR2Keys, disconnectR2Store,
  setR2Enabled, setR2Auto, r2TestConnection, r2ListBackups, r2DeleteObject,
  runR2Backup, restoreFromR2, ensureR2AutoLoop, r2LocalFreeMb, saveVaultEndpoint,
} from '@/lib/r2store'

export const dynamic = 'force-dynamic'

/**
 * v95 — Cloud Vault API on Cloudflare R2 (the owner's budget choice).
 *
 * GET  → full honest status: configured / connected / enabled / auto /
 *        last backup + restore-point list + vault usage.
 * POST → { action: save-config | save-keys | test | set-enabled | set-auto |
 *          backup-now | restore | delete-backup | disconnect }
 *
 * Honesty: the vault is a restore-point + artifact store in the owner's own
 * Cloudflare R2 bucket (free tier 10 GB, zero egress fees). It does NOT grow
 * the fixed sandbox disk, and it is NOT an editor bridge.
 */
export async function GET(req: NextRequest) {
  if (!(await isUnlockedRequest(req))) return NextResponse.json({ error: 'locked' }, { status: 401 })
  ensureR2AutoLoop()
  const st = await getR2StatusInput()
  let backups: Awaited<ReturnType<typeof r2ListBackups>> | null = null
  let error: string | null = null
  if (st.connected && st.enabled) {
    try { backups = await r2ListBackups() } catch (e: any) { error = String(e?.message || e) }
  }
  return NextResponse.json({
    ...st,
    backups: backups?.items || [],
    vaultUsedKb: backups?.usedKb ?? 0,
    error,
    localDiskFreeMb: localFreeMb(),
  })
}

export async function POST(req: NextRequest) {
  // SECURITY FIX: every action here writes PLATFORM-WIDE credentials or
  // storage settings (service accounts, R2 keys, auto-backup targets).
  // Any signed-in user could previously overwrite the owner's vault and
  // silently redirect every project backup into their own bucket.
  try { const { requireAdmin } = await import('@/lib/auth'); await requireAdmin(req) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  if (!(await isUnlockedRequest(req))) return NextResponse.json({ error: 'locked' }, { status: 401 })
  ensureR2AutoLoop()
  const body = await req.json().catch(() => null)
  const action = body?.action
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  if (action === 'save-config') {
    const parsed = await saveR2Config(String(body.config || ''))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...parsed })
  }

  if (action === 'save-keys') {
    const parsed = await saveR2Keys(String(body.keys || ''))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    // deep-verify right away so the owner learns about token/bucket problems NOW
    const test = await r2TestConnection()
    if (!test.ok) return NextResponse.json({ ok: true, saved: true, verified: false, warning: test.error, accessKeyId: parsed.accessKeyId })
    return NextResponse.json({ ok: true, saved: true, verified: true, accessKeyId: parsed.accessKeyId, bucket: test.bucket })
  }

  if (action === 'save-endpoint') {
    // v160 — custom S3-compatible endpoint (JOY SERVICE etc.). Empty clears it.
    const r = await saveVaultEndpoint(String(body.endpoint || ''))
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...r })
  }

  if (action === 'test') {
    const test = await r2TestConnection()
    return NextResponse.json(test, { status: test.ok ? 200 : 400 })
  }

  if (action === 'set-enabled') {
    await setR2Enabled(Boolean(body.enabled))
    return NextResponse.json({ ok: true, enabled: Boolean(body.enabled) })
  }

  if (action === 'set-auto') {
    // v116 — ADMIN-ONLY: this action moves PLATFORM-WIDE data
    // (full backup payload / DB restore) — owner exclusive.
    try { await requireAdmin(req) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    await setR2Auto(Boolean(body.auto))
    return NextResponse.json({ ok: true, auto: Boolean(body.auto) })
  }

  if (action === 'backup-now') {
    // v116 — ADMIN-ONLY: this action moves PLATFORM-WIDE data
    // (full backup payload / DB restore) — owner exclusive.
    try { await requireAdmin(req) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    const st = await getR2StatusInput()
    if (!st.connected) return NextResponse.json({ error: 'R2 vault is not connected yet — finish the two steps above' }, { status: 400 })
    if (!st.enabled) return NextResponse.json({ error: 'R2 vault is switched OFF — turn it on first' }, { status: 409 })
    if (r2LocalFreeMb() < 250) return NextResponse.json({ error: 'local disk critically low — free some space first (SDK Manager → uninstall an SDK)' }, { status: 507 })
    try {
      const result = await runR2Backup('manual')
      return NextResponse.json({ ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 })
    }
  }

  if (action === 'restore') {
    // v116 — ADMIN-ONLY: this action moves PLATFORM-WIDE data
    // (full backup payload / DB restore) — owner exclusive.
    try { await requireAdmin(req) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    const object = String(body.object || '')
    if (!object) return NextResponse.json({ error: 'object required' }, { status: 400 })
    try {
      const result = await restoreFromR2(object)
      return NextResponse.json({ object, ...result })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 })
    }
  }

  if (action === 'delete-backup') {
    // v116 — ADMIN-ONLY: this action moves PLATFORM-WIDE data
    // (full backup payload / DB restore) — owner exclusive.
    try { await requireAdmin(req) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    const object = String(body.object || '')
    if (!object) return NextResponse.json({ error: 'object required' }, { status: 400 })
    try {
      await r2DeleteObject(object)
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 })
    }
  }

  if (action === 'disconnect') {
    await disconnectR2Store()
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
}
