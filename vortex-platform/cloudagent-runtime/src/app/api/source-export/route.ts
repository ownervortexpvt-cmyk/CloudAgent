import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import fs from 'fs'
import path from 'path'
import { requireAdmin } from '@/lib/auth'
import { localFreeMb } from '@/lib/disk'
import { getFbStatusInput, fbUploadObject, FB_SOURCE_PREFIX } from '@/lib/fbstore'
import { getR2StatusInput, r2UploadObject, R2_SOURCE_PREFIX } from '@/lib/r2store'

export const dynamic = 'force-dynamic'

/**
 * v89 — TAKE THE SOURCE ANYWHERE (the honest answer to "jekonu editor e
 * niye cloud agent ke update korte parbo").
 *
 * Firebase Storage CANNOT bridge a PC editor to this sandbox — no cloud
 * service can reach in and live-edit a running sandbox app. What DOES work:
 * hand the owner the complete source as one archive, then it is his on any
 * device — VS Code / Android Studio / Cursor / Codex, GitHub, anything.
 *
 * GET  → streams a .tar.gz of the platform source (spawn tar, NO temp file):
 *        src, public, prisma, scripts, mini-services, projects, .zscripts,
 *        configs, .env — excluding node_modules/.next/.git/sdk/data dirs.
 * POST { action:'to-firebase' } → same archive, uploaded straight into the
 *        owner's cloud vault (v95 — R2 FIRST, the owner's budget choice;
 *        Firebase Storage stays as the fallback when R2 isn't connected;
 *        needs a few MB temp space).
 *
 * Honesty note (shown in the UI too): the DATABASE travels with the Cloud
 * Vault backup, not with this code archive; .env IS included — keep the
 * archive private.
 */

const BASE = '/home/z/my-project'

const TAR_EXCLUDES = [
  '--exclude', 'node_modules',
  '--exclude', '.next',
  '--exclude', '.git',
  '--exclude', 'sdk',
  '--exclude', 'upload',
  '--exclude', 'download',
  '--exclude', 'db',
  '--exclude', '.zdata',
  '--exclude', 'tool-results',
  '--exclude', '.snapshots',
  '--exclude', '.flutter-setup',
  '--exclude', '.dev-watchdog.lock',
  '--exclude', '.cache',
  '--exclude', '*.log',
  // not the owner's app source — 61 MB of agent-environment tooling docs
  // that would balloon a phone download for zero editor value
  '--exclude', 'skills',
  '--exclude', 'audit-shots',
]

function runTar(outputArg: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', [...TAR_EXCLUDES, ...outputArg, '-C', BASE, '.'], { stdio: ['ignore', 'inherit', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { if (err.length < 2000) err += String(d) })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar failed (exit ${code}) ${err.slice(0, 200)}`))))
    child.on('error', (e) => reject(new Error(`tar spawn failed: ${e?.message || e}`)))
  })
}

export async function GET(req: NextRequest) {
  // v116 — ADMIN-ONLY: this archive is the complete platform source INCLUDING
  // .env (secrets!). Any signed-in user could previously clone the whole
  // product. Owner (role=admin) exclusively now.
  try {
    await requireAdmin(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const child = spawn('tar', [...TAR_EXCLUDES, '-czf', '-', '-C', BASE, '.'], { stdio: ['ignore', 'pipe', 'ignore'] })
  req.signal.addEventListener('abort', () => { try { child.kill('SIGKILL') } catch {} })
  const body = Readable.toWeb(child.stdout as Readable) as unknown as ReadableStream
  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(body, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="cloud-agent-source-${stamp}.tar.gz"`,
      'cache-control': 'no-store',
    },
  })
}

export async function POST(req: NextRequest) {
  // v116 — ADMIN-ONLY: this archive is the complete platform source INCLUDING
  // .env (secrets!). Any signed-in user could previously clone the whole
  // product. Owner (role=admin) exclusively now.
  try {
    await requireAdmin(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const body = await req.json().catch(() => null)
  if (body?.action !== 'to-firebase') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  // v95: R2 first (owner's choice), Firebase fallback — whichever is connected.
  const r2st = await getR2StatusInput().catch(() => null)
  const useR2 = Boolean(r2st?.connected && r2st?.enabled)
  let fbStatus: Awaited<ReturnType<typeof getFbStatusInput>> | null = null
  if (!useR2) {
    fbStatus = await getFbStatusInput()
    if (!fbStatus.connected) {
      return NextResponse.json({ error: 'No cloud vault is connected — connect Cloudflare R2 (recommended) or Firebase in the Cloud Vault card first' }, { status: 400 })
    }
    if (!fbStatus.enabled) {
      return NextResponse.json({ error: 'The cloud vault is switched OFF — turn the vault switch on first' }, { status: 409 })
    }
  }
  if (localFreeMb() < 300) {
    return NextResponse.json({ error: 'local disk too low to stage the archive — free some space first' }, { status: 507 })
  }

  // Stage the archive locally (small: ~2-6 MB), then upload + clean up.
  const tmpDir = path.join(BASE, '.zdata', 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpPath = path.join(tmpDir, `cloud-agent-source-${Date.now()}.tar.gz`)
  try {
    await runTar(['-czf', tmpPath])
    const buf = fs.readFileSync(tmpPath)
    if (buf.length < 1024) throw new Error('archive came back empty')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (useR2) {
      const object = `${R2_SOURCE_PREFIX}cloud-agent-source-${stamp}.tar.gz`
      await r2UploadObject(object, buf, 'application/gzip')
      return NextResponse.json({ ok: true, object, sizeKb: Math.round(buf.length / 1024), vault: 'r2' })
    }
    const object = `${FB_SOURCE_PREFIX}cloud-agent-source-${stamp}.tar.gz`
    await fbUploadObject(object, buf, 'application/gzip')
    return NextResponse.json({ ok: true, object, sizeKb: Math.round(buf.length / 1024), vault: 'firebase' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 })
  } finally {
    try { fs.unlinkSync(tmpPath) } catch {}
  }
}
