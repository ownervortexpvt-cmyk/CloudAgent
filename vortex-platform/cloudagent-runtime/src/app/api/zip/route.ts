import { NextRequest, NextResponse } from 'next/server'
import AdmZip from 'adm-zip'
import busboy from 'busboy'
import yauzl from 'yauzl'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { spawn, execSync } from 'child_process'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { db } from '@/lib/db'
import * as storage from '@/lib/storage'
import { detectFramework } from '@/lib/framework'
import { localFreeMb, CRITICAL_DISK_MB } from '@/lib/disk'
import { tokenFromRequest } from '@/lib/lock'

/**
 * GET /api/zip?projectId=... → exports project as ZIP
 *   small projects (<200MB on disk) → in-memory AdmZip (proven path)
 *   big projects → `zip` CLI streams stdout, memory stays flat
 * POST /api/zip (multipart `file` + `projectId`) → imports ZIP
 *   v97 — owner spec: max ZIP size 1GB. The upload is STREAMED to a temp
 *   file (busboy), then extracted entry-by-entry with yauzl — the zip and
 *   its entries never sit in RAM, so a 1GB import runs on 4GB boxes.
 *   Guards: 1GB hard cap (mid-stream abort), per-entry 512MB, total
 *   uncompressed 3GB (zip-bomb), 50k entries, real-number disk gates with
 *   mid-extraction re-checks, same traversal/skip rules as v92.
 */
export const runtime = 'nodejs'

const MAX_ZIP_BYTES = 1024 * 1024 * 1024 // owner spec: 1GB (the zip file itself)
const MAX_BODY_BYTES = MAX_ZIP_BYTES + 16 * 1024 * 1024 // + multipart/zip-metadata wrapper slack
const MAX_TOTAL_UNCOMPRESSED = 3 * 1024 * 1024 * 1024 // zip-bomb guard
const MAX_ENTRY_UNCOMPRESSED = 1024 * 1024 * 1024 // a 1GB entry streams fine (RAM flat) — matches the zip cap
const MAX_ENTRIES = 50_000
const SMALL_EXPORT_BYTES = 200 * 1024 * 1024 // below → AdmZip in memory
const TEMP_PREFIX = '.import-'
const BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'wasm', 'mp3', 'mp4', 'woff', 'woff2', 'ttf', 'otf', 'so', 'dll', 'exe', 'bin'])
const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.dart_tool', '.export', 'Pods'])

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** v97 — /api/zip is excluded from the middleware matcher (its body-clone
 * truncates at 10MB and buffers the whole upload in RAM), so the route
 * enforces the IDENTICAL lock check itself. Same checks, same fail-closed
 * shapes as the middleware: HMAC token (cookie or x-ca-lock header) +
 * revocable session registry, 503 with Retry-After on DB outage. */
async function lockGuard(req: NextRequest): Promise<NextResponse | null> {
  try {
    const { verifySession } = await import('@/lib/auth')
    const presentedToken = tokenFromRequest(req)
    const sessionUser = await verifySession(presentedToken)
    if (sessionUser) return null
    return NextResponse.json({ ok: false, error: 'signed out — please log in' }, { status: 401, headers: { 'x-ca-lock-revoked': '1' } })
  } catch (dbErr) {
    console.error('[zip-route] DB unavailable — failing closed with 503:', (dbErr as any)?.message || dbErr)
    return NextResponse.json(
      { ok: false, error: 'temporarily unavailable — the builder database is not answering (server busy or restarting). Try again in a moment.' },
      { status: 503, headers: { 'Retry-After': '2' } },
    )
  }
}

function tmpPath(): string {
  return path.join(storage.PROJECTS_DIR, `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`)
}

/* ------------------------------ GET (export) ----------------------------- */

export async function GET(req: NextRequest) {
  const locked = await lockGuard(req)
  if (locked) return locked
  const projectId = req.nextUrl.searchParams.get('projectId')!
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  // SECURITY FIX: the ZIP download streamed ANY project's full source to ANY
  // signed-in user (verified: a free account exfiltrated another user's
  // project). Ownership is enforced now (admins exempt).
  try { const { requireProjectAccess } = await import('@/lib/auth'); await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const root = storage.projectRoot(projectId)
  const filename = `${project.name.replace(/[^a-z0-9]+/gi, '-')}.zip`
  const headers = {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
  }

  let onDisk = 0
  try { onDisk = parseInt(execSync(`du -sk ${JSON.stringify(root)}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\t')[0] || '0', 10) * 1024 } catch {}

  // Big projects stream through the zip CLI — a 1GB project must not be
  // buffered into the 4GB sandbox (same wall the import side just lost).
  if (onDisk >= SMALL_EXPORT_BYTES) {
    if (!fs.existsSync(root)) return emptyZip(headers)
    const exclude: string[] = []
    for (const d of IGNORE_DIRS) { exclude.push(`${d}/*`, `${d}/`) }
    const child = spawn('zip', ['-ry', '-', '.', '-x', ...exclude], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    child.on('error', () => child.stdout.destroy())
    if (!child.stdout) return NextResponse.json({ error: 'zip tool failed' }, { status: 500 })
    return new Response(Readable.toWeb(child.stdout) as unknown as ReadableStream, { headers })
  }

  // Small projects — proven in-memory path
  const zip = new AdmZip()
  function walk(dir: string, base = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue
      const full = `${dir}/${e.name}`
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) walk(full, rel)
      else zip.addFile(rel, fs.readFileSync(full))
    }
  }
  try {
    walk(root)
  } catch {
    // Project dir deleted on disk while the DB row still exists — empty zip
  }
  const buf = zip.toBuffer()
  return new Response(new Uint8Array(buf), {
    headers: { ...headers, 'Content-Length': String(buf.length) },
  })
}

function emptyZip(headers: Record<string, string>) {
  const buf = new AdmZip().toBuffer()
  return new Response(new Uint8Array(buf), { headers: { ...headers, 'Content-Length': String(buf.length) } })
}

/* ------------------------------ POST (import) ---------------------------- */

export async function POST(req: NextRequest) {
  const locked = await lockGuard(req)
  if (locked) return locked
  const freeMb = localFreeMb()
  if (freeMb < CRITICAL_DISK_MB) {
    return NextResponse.json({ error: `Disk almost full (${freeMb}MB free) — free space first, then import` }, { status: 507 })
  }
  const declared = parseInt(req.headers.get('content-length') || '0', 10)
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `ZIP too large — max 1GB (got ${(declared / 1024 / 1024).toFixed(0)}MB)` }, { status: 413 })
  }
  // temp copy + extracted content (worst case ≈ zip size for stored/compressed data) + margin
  if (declared > 0 && freeMb < declared / 1024 / 1024 + Math.min(declared / 1024 / 1024, 1024) + 300) {
    return NextResponse.json({ error: `Not enough disk: this ZIP needs ~${((declared / 1024 / 1024) * 2 + 300).toFixed(0)}MB free, only ${freeMb}MB left` }, { status: 507 })
  }

  const temp = tmpPath()
  let zipfile: yauzl.ZipFile | null = null
  let pidResolved: string | null = null
  try {
    // 1) stream the multipart upload to a temp file (RAM stays flat)
    const { projectId, bytes } = await streamToTemp(req, temp)
    const qId = req.nextUrl.searchParams.get('projectId')
    const pid = qId || projectId
    if (!pid) return NextResponse.json({ error: 'file and projectId required' }, { status: 400 })
    const projectRow = await db.project.findUnique({ where: { id: pid } })
    if (!projectRow) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    pidResolved = pid

    // 2) open with yauzl — streaming unzip, nothing buffered whole
    zipfile = await openZip(temp)

    // 3) pass 1 — collect central-directory entries, enforce size bombs
    const entries = await collectEntries(zipfile)
    if (entries.length > MAX_ENTRIES) {
      return NextResponse.json({ error: `ZIP has ${entries.length} entries — max ${MAX_ENTRIES}` }, { status: 413 })
    }
    const totalUncompressed = entries.reduce((s, e) => s + e.size, 0)
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      return NextResponse.json({ error: `ZIP expands to ${(totalUncompressed / 1024 / 1024 / 1024).toFixed(1)}GB — over the 3GB safety cap (possible zip bomb)` }, { status: 413 })
    }
    const big = entries.find(e => e.size > MAX_ENTRY_UNCOMPRESSED)
    if (big) {
      return NextResponse.json({ error: `Single file too big inside ZIP: ${big.name} (${(big.size / 1024 / 1024).toFixed(0)}MB, max 512MB)` }, { status: 413 })
    }

    // 4) pass 2 — extract with the exact v92 path rules
    const imported = await extractAll(zipfile, entries, pid, bytes)

    // 5) re-detect framework + respond (same contract as v92)
    const detection = detectFramework(pid)
    await db.project.update({
      where: { id: pid },
      data: { framework: detection.framework, runtime: detection.runtime, language: detection.language },
    })
    return NextResponse.json({ ok: true, imported, detection })
  } catch (err) {
    const e = err as Error
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status })
    // Real-world zips from odd tools can carry central-directory quirks yauzl
    // refuses (self-extracting stubs, offset drift). The proven v92 AdmZip
    // engine gets a shot — small files only, it buffers the whole archive.
    if (pidResolved && /central directory|BadZipFile|not a valid zip/i.test(e.message)) {
      const tempSize = fs.existsSync(temp) ? fs.statSync(temp).size : 0
      if (tempSize > 0 && tempSize <= SMALL_EXPORT_BYTES) {
        try {
          const imported = legacyAdmZipImport(temp, pidResolved)
          const detection = detectFramework(pidResolved)
          await db.project.update({
            where: { id: pidResolved },
            data: { framework: detection.framework, runtime: detection.runtime, language: detection.language },
          })
          return NextResponse.json({ ok: true, imported, detection, engine: 'admzip-fallback' })
        } catch {}
      }
      return NextResponse.json({ error: 'not a valid zip file' }, { status: 400 })
    }
    return NextResponse.json({ error: e.message || 'import failed' }, { status: 500 })
  } finally {
    try { zipfile?.close() } catch {}
    await fsp.rm(temp, { force: true }).catch(() => {})
  }
}

/** Stream the multipart body to `temp`; resolve projectId + byte count. */
function streamToTemp(req: NextRequest, temp: string): Promise<{ projectId: string | null; bytes: number }> {
  return new Promise((resolve, reject) => {
    let bb: busboy.Busboy
    try {
      bb = busboy({
        headers: { 'content-type': req.headers.get('content-type') || '' },
        limits: { fields: 20, files: 1, fieldSize: 64 * 1024 },
      })
    } catch {
      reject(new HttpError(400, 'multipart form data expected'))
      return
    }
    const ws = fs.createWriteStream(temp)
    let projectId: string | null = null
    let bytes = 0
    let sawFile = false
    let settled = false
    let src: Readable | null = null
    const deadline = setTimeout(() => { src?.destroy(new HttpError(408, 'upload timed out — connection stalled; try again or use a smaller ZIP')) }, 15 * 60 * 1000)
    const done = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (err) { try { ws.destroy() } catch {} ; reject(err) }
      else resolve({ projectId, bytes })
    }
    bb.on('field', (name, val) => { if (name === 'projectId') projectId = val })
    bb.on('file', (_name, stream) => {
      sawFile = true
      stream.pipe(ws)
      stream.on('limit', () => done(new HttpError(413, 'ZIP too large — max 1GB')))
    })
    bb.on('error', (err: Error) => done(err instanceof HttpError ? err : new HttpError(400, err.message || 'multipart form data expected')))
    bb.on('close', () => { if (!sawFile) done(new HttpError(400, 'file field missing (multipart with `file` required)')); else ws.end(() => done()) })
    ws.on('error', err => done(err))

    if (!req.body) { done(new HttpError(400, 'multipart form data expected')); return }
    src = Readable.fromWeb(req.body as unknown as import('stream/web').ReadableStream)
    // mid-stream 1GB cap — abort and clean up, never buffer past the cap
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) { cb(new HttpError(413, `ZIP too large — max 1GB (streamed ${(bytes / 1024 / 1024).toFixed(0)}MB)`)); return }
        cb(null, chunk)
      },
    })
    counter.on('error', err => {
      try { ws.destroy() } catch {}
      try { src?.destroy() } catch {}
      done(err)
    })
    src.on('error', err => done(err instanceof HttpError ? err : new HttpError(400, err.message || 'upload aborted')))
    src.pipe(counter).pipe(bb)
  })
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // decodeStrings:false — yauzl would otherwise EMIT 'error' (and wedge its
    // cursor) the moment a central-directory name contains `../`. We decode
    // the name ourselves and let the v92 path guards skip evil entries
    // exactly like the old AdmZip engine did.
    yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: false }, (err, zf) => {
      if (err || !zf) reject(new Error(err?.message || 'end of central directory not found — not a valid zip file'))
      else resolve(zf)
    })
  })
}

type Entry = { entry: yauzl.Entry; name: string; size: number }

function collectEntries(zf: yauzl.ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const out: Entry[] = []
    const step = () => zf.readEntry()
    zf.on('entry', (entry: yauzl.Entry) => {
      // decodeStrings:false → fileName arrives raw; decode utf8 like AdmZip did
      const name = Buffer.isBuffer(entry.fileName) ? (entry.fileName as unknown as Buffer).toString('utf8') : String(entry.fileName)
      out.push({ entry, name, size: entry.uncompressedSize })
      if (out.length > MAX_ENTRIES) { reject(new HttpError(413, `ZIP has >${MAX_ENTRIES} entries — max ${MAX_ENTRIES}`)); return }
      step()
    })
    zf.on('end', () => resolve(out))
    zf.on('error', err => reject(new Error(err.message || 'end of central directory not found — not a valid zip file')))
    step()
  })
}

/** v92 engine, preserved verbatim as the small-zip fallback (buffers in RAM). */
function legacyAdmZipImport(file: string, projectId: string): number {
  const zip = new AdmZip(file)
  const entries = zip.getEntries()
  let imported = 0
  const topLevelDir = entries.length > 0 && entries.every(e => e.entryName.startsWith(entries[0].entryName.split('/')[0] + '/'))
    ? entries[0].entryName.split('/')[0] + '/'
    : ''
  for (const entry of entries) {
    if (entry.isDirectory) continue
    let p = entry.entryName
    if (topLevelDir && p.startsWith(topLevelDir)) p = p.slice(topLevelDir.length)
    p = p.replace(/\\/g, '/')
    if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('../') || p.includes('/../')) continue
    if (p.includes('node_modules/') || p.startsWith('.git/')) continue
    try {
      const data = entry.getData()
      storage.writeFile(projectId, p, data)
      const ext = p.split('.').pop()?.toLowerCase()
      if (!BINARY_EXT.has(ext || '') && data.length <= 2_000_000) {
        const content = data.toString('utf8')
        db.file.upsert({
          where: { projectId_path: { projectId, path: p } },
          create: { projectId, path: p, content, isDir: false },
          update: { content },
        }).catch(() => {})
      }
      imported++
    } catch {}
  }
  return imported
}

/** v92 rules, verbatim: backslash normalize, strip shared top-level folder,
 * reject traversal/absolute, skip node_modules/.git — then stream to disk. */
async function extractAll(zf: yauzl.ZipFile, entries: Entry[], projectId: string, zipBytes: number): Promise<number> {
  const firstTop = entries[0]?.name.split('/')[0] || ''
  const topLevelDir = entries.length > 0 && entries.every(e => e.name.startsWith(firstTop + '/')) ? firstTop + '/' : ''
  let imported = 0
  for (const { entry, name } of entries) {
    if (name.endsWith('/')) continue // directory entry
    let p = name.replace(/\\/g, '/')
    if (topLevelDir && p.startsWith(topLevelDir)) p = p.slice(topLevelDir.length)
    if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('../') || p.includes('/../')) continue
    if (p.includes('node_modules/') || p.startsWith('.git/')) continue
    try {
      await writeEntry(zf, entry, projectId, p)
      const ext = p.split('.').pop()?.toLowerCase()
      if (!BINARY_EXT.has(ext || '') && entry.uncompressedSize <= 2_000_000) {
        try {
          const content = fs.readFileSync(path.join(storage.projectRoot(projectId), p)).toString('utf8')
          await db.file.upsert({
            where: { projectId_path: { projectId, path: p } },
            create: { projectId, path: p, content, isDir: false },
            update: { content },
          }).catch(() => {})
        } catch {}
      }
      imported++
      // honest disk re-check: extraction can expand 1GB → more; bail before the box chokes
      if (imported % 100 === 0 && localFreeMb() < 400) {
        throw new HttpError(507, `Disk ran low mid-import (${localFreeMb()}MB free) — ${imported} files landed, the rest were skipped; free space and re-import`)
      }
    } catch (err) {
      if (err instanceof HttpError) throw err
      // single-entry failure (e.g. odd name) must not kill the import — v92 behavior
    }
  }
  return imported
}

function writeEntry(zf: yauzl.ZipFile, entry: yauzl.Entry, projectId: string, rel: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zf.openReadStream(entry, (err, read) => {
      if (err || !read) { reject(err || new Error('no stream for entry')); return }
      const ws = storage.writeFileStream(projectId, rel)
      ws.on('error', reject)
      read.on('error', reject)
      read.pipe(ws)
      ws.on('finish', () => resolve())
    })
  })
}
