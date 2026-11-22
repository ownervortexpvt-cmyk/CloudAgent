import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as storage from '@/lib/storage'
import { requireProjectAccess } from '@/lib/auth'
import { publishEvent, type CollabAction } from '@/lib/collab'

/**
 * Files API — all DB writes are wrapped in try/catch so a foreign key
 * constraint violation (project row deleted but UI still showing it) doesn't
 * cause a 500 error. The file on disk is the source of truth; the DB row is
 * best-effort.
 */

/** v123 — best-effort identity for collaboration events (never breaks a save). */
async function collabIdentity(req: NextRequest): Promise<{ byUserId: string; byName: string }> {
  try {
    const { requireUser } = await import('@/lib/auth')
    const u = await requireUser(req)
    return { byUserId: u.id, byName: u.name || u.email.split('@')[0] }
  } catch { return { byUserId: '', byName: 'teammate' } }
}

function collabFire(projectId: string, path: string, action: CollabAction, who: { byUserId: string; byName: string }) {
  if (!who.byUserId) return
  publishEvent(projectId, { path, action, byUserId: who.byUserId, byName: who.byName })
}
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')!
  const path = req.nextUrl.searchParams.get('path')!
  if (!projectId || !path) return NextResponse.json({ error: 'projectId and path required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  try {
    if (!storage.existsFile(projectId, path)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    // v62: ?encoding=base64 returns the REAL bytes (readBinary) base64-encoded
    // — images and other binaries download/preview without utf8 corruption.
    if (req.nextUrl.searchParams.get('encoding') === 'base64') {
      const buf = storage.readBinary(projectId, path)
      return NextResponse.json({ path, content: buf.toString('base64'), encoding: 'base64', size: buf.length })
    }
    const content = storage.readFile(projectId, path)
    return NextResponse.json({ path, content })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, path, content, op } = body
  if (!projectId || !path) return NextResponse.json({ error: 'projectId and path required' }, { status: 400 })
  // SECURITY FIX: POST (write/save/delete/rename/mkdir) had NO ownership
  // check while GET did — a free account could write and delete files in
  // ANY other user's project (verified: wrote pwn2.txt + hacked.txt).
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const who = await collabIdentity(req)

  if (op === 'delete') {
    storage.deleteFile(projectId, path)
    // Match the exact row OR children under the folder — the old bare
    // startsWith(path) also nuked sibling rows like `foo.txt.bak` when
    // deleting `foo.txt`.
    try {
      await db.file.deleteMany({
        where: {
          projectId,
          OR: [{ path }, { path: { startsWith: path + '/' } }],
        },
      })
    } catch {}
    collabFire(projectId, path, 'delete', who)
    return NextResponse.json({ ok: true })
  }
  if (op === 'move') {
    const { to } = body
    if (!to) return NextResponse.json({ error: 'to required for move' }, { status: 400 })
    storage.moveFile(projectId, path, to)
    try {
      // Rename the moved row AND all descendant rows (moving a folder used to
      // leave children with stale paths in the DB mirror)
      const rows = await db.file.findMany({ where: { projectId, OR: [{ path }, { path: { startsWith: path + '/' } }] } })
      for (const row of rows) {
        const newPath = row.path === path ? to : to + row.path.slice(path.length)
        await db.file.update({ where: { id: row.id }, data: { path: newPath } }).catch(() => {})
      }
    } catch {}
    collabFire(projectId, to, 'rename', who)
    return NextResponse.json({ ok: true })
  }
  if (op === 'createFolder') {
    storage.writeFile(projectId, `${path}/.gitkeep`, '')
    return NextResponse.json({ ok: true })
  }
  if (op === 'writeBase64') {
    // Used by image/screenshot attach — writes real binary files
    const { contentBase64 } = body
    if (!contentBase64) return NextResponse.json({ error: 'contentBase64 required' }, { status: 400 })
    const buf = Buffer.from(contentBase64, 'base64')
    storage.writeFile(projectId, path, buf)
    // Mirror the row into the DB index (content stays empty — binaries are
    // not text-searchable; the disk file remains the source of truth).
    try {
      await db.file.upsert({
        where: { projectId_path: { projectId, path } },
        create: { projectId, path, content: '', isDir: false },
        update: { content: '' },
      })
    } catch {}
    return NextResponse.json({ ok: true, path, bytes: buf.length })
  }
  if (op && op !== 'write') {
    // Unknown ops MUST 400 — the old fall-through treated any unknown op as a
    // plain write, silently creating files at attacker-chosen paths
    // v137 FIX: FileTree.submitCreate() sends op:'write' for every New-file
    // creation; that used to land here and 400 ("unknown op: write"), so the
    // New-file button NEVER created a file. 'write' is now accepted as the
    // plain write fall-through; genuinely unknown ops still 400.
    return NextResponse.json({ error: `unknown op: ${op}` }, { status: 400 })
  }
  // Default: write file
  storage.writeFile(projectId, path, content || '')
  try {
    await db.file.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, content: content || '', isDir: false },
      update: { content: content || '' },
    })
  } catch (e) {
    console.warn('file DB upsert failed (continuing — disk write succeeded):', e)
  }
  collabFire(projectId, path, 'save', who)
  return NextResponse.json({ ok: true })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { projectId, path, content } = body
  if (!projectId || !path) return NextResponse.json({ error: 'projectId and path required' }, { status: 400 })
  // SECURITY FIX: editor-save (PUT) also lacked the ownership check.
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  storage.writeFile(projectId, path, content || '')
  try {
    await db.file.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, content: content || '', isDir: false },
      update: { content: content || '' },
    })
  } catch (e) {
    console.warn('file DB upsert failed (continuing — disk write succeeded):', e)
  }
  const who = await collabIdentity(req)
  collabFire(projectId, path, 'save', who)
  return NextResponse.json({ ok: true })
}
