/**
 * /api/versions — Version History (time-travel).
 *  GET  ?projectId=            → list snapshots (newest first)
 *  POST { projectId, action }  → snapshot | restore | delete | diff
 */
import { NextRequest, NextResponse } from 'next/server'
import { snapshotProject, listVersions, restoreVersion, deleteVersion, diffVersion } from '@/lib/versions'
import { requireProjectAccess } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId') || ''
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const versions = await listVersions(projectId)
  return NextResponse.json({ ok: true, versions })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const { projectId, action } = body || {}
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // SECURITY FIX: POST (snapshot/restore/delete/diff) lacked the ownership
  // check that GET already had — any signed-in user could snapshot, roll
  // back or delete ANY other user's project history.
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }

  try {
    if (action === 'snapshot') {
      const snap = await snapshotProject(projectId, String(body.label || 'manual snapshot'))
      return NextResponse.json({ ok: true, snapshot: snap })
    }
    if (action === 'restore') {
      if (!body.id) return NextResponse.json({ ok: false, error: 'snapshot id required' }, { status: 400 })
      const out = await restoreVersion(projectId, String(body.id))
      return NextResponse.json({ ok: true, ...out })
    }
    if (action === 'delete') {
      if (!body.id) return NextResponse.json({ ok: false, error: 'snapshot id required' }, { status: 400 })
      await deleteVersion(projectId, String(body.id))
      return NextResponse.json({ ok: true })
    }
    if (action === 'diff') {
      // v62: snapshot vs current files — per-file unified line diff
      if (!body.id) return NextResponse.json({ ok: false, error: 'snapshot id required' }, { status: 400 })
      const out = await diffVersion(projectId, String(body.id))
      return NextResponse.json({ ok: true, ...out })
    }
    return NextResponse.json({ ok: false, error: 'action must be snapshot | restore | delete | diff' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'version operation failed' }, { status: 400 })
  }
}
