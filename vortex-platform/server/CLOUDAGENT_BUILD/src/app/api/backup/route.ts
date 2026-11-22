import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { buildBackupPayload, restoreBackupPayload } from '@/lib/backup-core'

/**
 * v58 — 💾 FULL BACKUP & RESTORE (one JSON file with the whole army base).
 *
 * GET  /api/backup            → downloadable snapshot
 * POST /api/backup  <backup>  → additive restore
 *
 * v116 — ADMIN-ONLY. This snapshot carries every project, file, provider
 * config and run of the WHOLE platform — a signed-in regular user could
 * walk away with the entire business in one click. The old lock-guard
 * (any authenticated session) was an IP leak; only the owner (role=admin)
 * may touch it now. UI lives exclusively in the secret control room.
 *
 * v89: the payload builder + restore engine moved to src/lib/backup-core.ts
 * so the vault (manual + scheduled backups, with no incoming request)
 * reuses the EXACT same code. See backup-core.ts for the full contract.
 */

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const { backup } = await buildBackupPayload()
  return NextResponse.json({ ok: true, backup })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const body = (await req.json().catch(() => null)) as
    | { backup?: any }
    | { kind?: string; data?: any }
    | null
  const backup = body && 'backup' in body && body.backup ? body.backup : body
  if (!backup || backup.kind !== 'cloud-agent-backup' || !backup.data || !Array.isArray(backup.data.projects)) {
    return NextResponse.json(
      { error: 'This file is not a Cloud Agent backup (kind "cloud-agent-backup" with data.projects expected).' },
      { status: 400 }
    )
  }

  const result = await restoreBackupPayload(backup)
  return NextResponse.json(result)
}
