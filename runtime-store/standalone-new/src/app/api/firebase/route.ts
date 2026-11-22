import { NextRequest, NextResponse } from 'next/server'
import { isUnlockedRequest } from '@/lib/lock'
import { requireAdmin } from '@/lib/auth'
import { localFreeMb } from '@/lib/disk'
import {
  getFbStatusInput, saveFirebaseConfig, saveServiceAccount, disconnectFbStore,
  setFbEnabled, setFbAuto, fbTestConnection, fbListBackups, fbDeleteObject,
  runVaultBackup, restoreFromVault, ensureFbAutoLoop, vaultLocalFreeMb,
} from '@/lib/fbstore'

export const dynamic = 'force-dynamic'

/**
 * v89 — Cloud Vault API (Firebase Storage).
 *
 * GET  → full honest status: configured / connected / enabled / auto /
 *        last backup + restore-point list + vault usage.
 * POST → { action: save-config | save-service-account | test | set-enabled |
 *          set-auto | backup-now | restore | delete-backup | disconnect }
 *
 * Honesty: the vault is a restore-point store in the owner's own Firebase
 * project. It does NOT grow the fixed sandbox disk, and it is NOT an editor
 * bridge — the source-export card covers that.
 */
export async function GET(req: NextRequest) {
  if (!(await isUnlockedRequest(req))) return NextResponse.json({ error: 'locked' }, { status: 401 })
  ensureFbAutoLoop()
  const st = await getFbStatusInput()
  let backups: Awaited<ReturnType<typeof fbListBackups>> | null = null
  let error: string | null = null
  if (st.connected && st.enabled) {
    try { backups = await fbListBackups() } catch (e: any) { error = String(e?.message || e) }
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
  ensureFbAutoLoop()
  const body = await req.json().catch(() => null)
  const action = body?.action
  if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  if (action === 'save-config') {
    const parsed = await saveFirebaseConfig(String(body.config || ''))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...parsed })
  }

  if (action === 'save-service-account') {
    const parsed = await saveServiceAccount(String(body.json || ''))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    // deep-verify right away so the owner learns about IAM problems NOW
    const test = await fbTestConnection()
    if (!test.ok) return NextResponse.json({ ok: true, saved: true, verified: false, warning: test.error, serviceAccountEmail: parsed.client_email })
    return NextResponse.json({ ok: true, saved: true, verified: true, serviceAccountEmail: parsed.client_email, location: test.location || null })
  }

  if (action === 'test') {
    const test = await fbTestConnection()
    return NextResponse.json(test, { status: test.ok ? 200 : 400 })
  }

  if (action === 'set-enabled') {
    await setFbEnabled(Boolean(body.enabled))
    return NextResponse.json({ ok: true, enabled: Boolean(body.enabled) })
  }

  if (action === 'set-auto') {
    // v116 — ADMIN-ONLY: this action moves PLATFORM-WIDE data
    // (full backup payload / DB restore) — owner exclusive.
    try { await requireAdmin(req) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    await setFbAuto(Boolean(body.auto))
    return NextResponse.json({ ok: true, auto: Boolean(body.auto) })
  }

  if (action === 'backup-now') {
    // v116 — ADMIN-ONLY: this action moves PLATFORM-WIDE data
    // (full backup payload / DB restore) — owner exclusive.
    try { await requireAdmin(req) } catch (e: any) {
      if (e instanceof Response) return e as any
      throw e
    }
    const st = await getFbStatusInput()
    if (!st.connected) return NextResponse.json({ error: 'Cloud Vault is not connected yet — finish the two steps above' }, { status: 400 })
    if (!st.enabled) return NextResponse.json({ error: 'Cloud Vault is switched OFF — turn it on first' }, { status: 409 })
    if (vaultLocalFreeMb() < 250) return NextResponse.json({ error: 'local disk critically low — free some space first (SDK Manager → uninstall an SDK)' }, { status: 507 })
    try {
      const result = await runVaultBackup('manual')
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
      const result = await restoreFromVault(object)
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
      await fbDeleteObject(object)
      return NextResponse.json({ ok: true })
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 })
    }
  }

  if (action === 'disconnect') {
    await disconnectFbStore()
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
}
