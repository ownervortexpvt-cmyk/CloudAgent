/**
 * Version History / Time-travel — snapshot a project's files at any moment
 * and restore them later. Snapshots live OUTSIDE projects/<id>
 * (.snapshots/<projectId>/<ts>/) so they never appear in the file tree,
 * never get served, and never get caught in project-wide file operations.
 */
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { projectRoot, writeFile, deleteFile } from '@/lib/storage'
import { diffLines, type DiffLine } from '@/lib/diff'

const SNAP_ROOT = path.join(process.cwd(), '.snapshots')

function listProjectFiles(root: string, base = ''): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...listProjectFiles(path.join(root, e.name), rel))
    else out.push(rel)
  }
  return out
}

export async function snapshotProject(projectId: string, label = 'manual snapshot'): Promise<{ id: string; fileCount: number; bytes: number }> {
  const root = projectRoot(projectId)
  if (!fs.existsSync(root)) throw new Error('project has no files yet')
  const dir = path.join(SNAP_ROOT, projectId, String(Date.now()))
  fs.mkdirSync(dir, { recursive: true })

  let bytes = 0
  const files = listProjectFiles(root)
  for (const rel of files) {
    const src = path.join(root, rel)
    const dst = path.join(dir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    const buf = fs.readFileSync(src)
    bytes += buf.length
    fs.writeFileSync(dst, buf)
  }

  const row = await db.versionSnapshot.create({
    data: { projectId, label, fileCount: files.length, bytes, dir },
  })
  return { id: row.id, fileCount: files.length, bytes }
}

export async function listVersions(projectId: string) {
  return db.versionSnapshot.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export async function restoreVersion(projectId: string, snapshotId: string): Promise<{ restored: number }> {
  const snap = await db.versionSnapshot.findUnique({ where: { id: snapshotId } })
  if (!snap || snap.projectId !== projectId) throw new Error('snapshot not found')
  const dir = snap.dir
  if (!fs.existsSync(dir)) throw new Error('snapshot data missing on disk')

  const root = projectRoot(projectId)
  // Wipe current files (dirs too) — but keep the project dir itself.
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name)
    fs.rmSync(p, { recursive: true, force: true })
  }
  // Copy snapshot contents back through storage.writeFile so the DB file
  // index stays in sync with the disk.
  let restored = 0
  const rels = listProjectFiles(dir)
  for (const rel of rels) {
    const content = fs.readFileSync(path.join(dir, rel))
    writeFile(projectId, rel, content)
    restored++
  }
  await db.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } }).catch(() => {})
  return { restored }
}

export async function deleteVersion(projectId: string, snapshotId: string): Promise<void> {
  const snap = await db.versionSnapshot.findUnique({ where: { id: snapshotId } })
  if (!snap || snap.projectId !== projectId) throw new Error('snapshot not found')
  fs.rmSync(snap.dir, { recursive: true, force: true })
  await db.versionSnapshot.delete({ where: { id: snapshotId } })
}

// ─── v62: diff a snapshot against the current project files ────────────────

const DIFF_MAX_FILES = 60 // changed files reported at most
const DIFF_MAX_BYTES = 2_000_000 // per-file read cap (2 MB)

export interface FileDiff {
  path: string
  added: number
  removed: number
  truncated?: boolean
  lines: DiffLine[]
}

export async function diffVersion(projectId: string, snapshotId: string): Promise<{
  changed: number
  addedFiles: number
  removedFiles: number
  files: FileDiff[]
}> {
  const snap = await db.versionSnapshot.findUnique({ where: { id: snapshotId } })
  if (!snap || snap.projectId !== projectId) throw new Error('snapshot not found')
  const dir = snap.dir
  if (!fs.existsSync(dir)) throw new Error('snapshot data missing on disk')
  const root = projectRoot(projectId)

  const snapFiles = new Set(fs.existsSync(dir) ? listProjectFiles(dir) : [])
  const curFiles = new Set(fs.existsSync(root) ? listProjectFiles(root) : [])

  const files: FileDiff[] = []
  let addedFiles = 0
  let removedFiles = 0

  // Files changed between the two trees (edited, added, removed)
  const touched = new Set<string>()
  for (const f of snapFiles) touched.add(f)
  for (const f of curFiles) touched.add(f)

  for (const rel of [...touched].sort()) {
    if (files.length >= DIFF_MAX_FILES) break
    const inSnap = snapFiles.has(rel)
    const inCur = curFiles.has(rel)
    if (inSnap === inCur) continue // identical presence + same mtime set? presence equality alone isn't enough — compare content below
    const oldText = inSnap ? readMaybe(path.join(dir, rel)) : null
    const curText = inCur ? readMaybe(path.join(root, rel)) : null
    if (oldText === null && curText === null) continue
    if (oldText !== null && curText !== null && oldText === curText) continue // touched but identical content
    if (!inSnap) addedFiles++
    if (!inCur) removedFiles++
    const lines = diffLines(oldText ?? '', curText ?? '').slice(0, 1200)
    files.push({
      path: rel,
      added: lines.filter(l => l.t === '+').length,
      removed: lines.filter(l => l.t === '-').length,
      truncated: lines.length >= 1200 || undefined,
      lines,
    })
  }

  // Edited-in-place files (present in both trees, same name, different bytes)
  if (files.length < DIFF_MAX_FILES) {
    for (const rel of [...snapFiles].sort()) {
      if (files.length >= DIFF_MAX_FILES) break
      if (!curFiles.has(rel)) continue // already handled above as added/removed
      if (files.some(f => f.path === rel)) continue
      const oldText = readMaybe(path.join(dir, rel))
      const curText = readMaybe(path.join(root, rel))
      if (oldText === null || curText === null) continue
      if (oldText === curText) continue
      const lines = diffLines(oldText, curText).slice(0, 1200)
      files.push({
        path: rel,
        added: lines.filter(l => l.t === '+').length,
        removed: lines.filter(l => l.t === '-').length,
        truncated: lines.length >= 1200 || undefined,
        lines,
      })
    }
  }

  files.sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
  return { changed: files.length, addedFiles, removedFiles, files }
}

function readMaybe(full: string): string | null {
  try {
    const st = fs.statSync(full)
    if (!st.isFile() || st.size > DIFF_MAX_BYTES) return null
    const buf = fs.readFileSync(full)
    // Binary guard — NUL byte in the first 8 KB ⇒ treat as binary, show no line diff
    if (buf.subarray(0, 8192).includes(0)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

export { deleteFile }
