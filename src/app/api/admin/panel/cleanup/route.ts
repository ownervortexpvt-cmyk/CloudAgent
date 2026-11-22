/**
 * v116 — CONTROL-ROOM DISK CLEANUP (one click, everything reclaimable).
 *
 * POST { target } where target:
 *   'old-zips'    → every cloud-agent-full-backup-*.zip except the newest
 *   'orphans'     → projects/<id> dirs with NO DB row (deleted apps' leftovers)
 *   'next-cache'  → .next/cache (webpack build cache — rebuilt on demand)
 *   'tmp'         → our own /tmp scratch files (ca-*, vite-*, backup-*)
 *   'all'         → all of the above, safest order
 *
 * Returns what was freed in MB. NEVER touches: db/, projects that exist in
 * the DB, node_modules of live apps (their next cold start would crawl),
 * local-ai models, SDKs.
 *
 * Double-gated: admin session AND room PIN.
 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdminUnlocked } from '@/lib/admin-lock'

export const dynamic = 'force-dynamic'

const ROOT = process.env.PROJECT_ROOT || '/home/z/my-project'

function rmRf(p: string): boolean {
  try {
    fs.rmSync(p, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

function dirMb(p: string): number {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return Math.round(st.size / (1024 * 1024))
    // small recursive walk — cleanup targets are few and shallow
    let total = 0
    const stack = [p]
    while (stack.length) {
      const d = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const full = path.join(d, e.name)
        try {
          if (e.isDirectory()) stack.push(full)
          else total += fs.statSync(full).size
        } catch { /* vanished mid-walk */ }
      }
    }
    return Math.round(total / (1024 * 1024))
  } catch {
    return 0
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const body = await req.json().catch(() => ({}))
  const target = String(body?.target || 'all')
  const freed: Record<string, number> = {}

  // 1) old full-backup zips (keep the newest one — the owner's download link)
  if (target === 'old-zips' || target === 'all') {
    const dl = path.join(ROOT, 'download')
    try {
      const zips = fs.readdirSync(dl)
        .filter((f) => /^cloud-agent-full-backup-\d{8}\.zip$/.test(f))
        .map((f) => ({ f, m: fs.statSync(path.join(dl, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
      let mb = 0
      for (const z of zips.slice(1)) {
        mb += dirMb(path.join(dl, z.f))
        rmRf(path.join(dl, z.f))
      }
      freed.oldZips = mb
    } catch { freed.oldZips = 0 }
  }

  // 2) orphan project dirs (disk rows whose DB row is gone)
  if (target === 'orphans' || target === 'all') {
    const { db } = await import('@/lib/db')
    const projectsRoot = path.join(ROOT, 'projects')
    try {
      const ids = new Set(
        (await db.project.findMany({ select: { id: true } })).map((p) => p.id)
      )
      let mb = 0
      let n = 0
      for (const d of fs.readdirSync(projectsRoot)) {
        if (ids.has(d)) continue
        const full = path.join(projectsRoot, d)
        if (!fs.statSync(full).isDirectory()) continue
        mb += dirMb(full)
        if (rmRf(full)) n++
      }
      freed.orphanProjects = mb
      freed.orphanProjectCount = n as any
    } catch { freed.orphanProjects = 0 }
  }

  // 3) next build cache (safe: webpack re-caches on the next build)
  if (target === 'next-cache' || target === 'all') {
    const cache = path.join(ROOT, '.next', 'cache')
    freed.nextCache = fs.existsSync(cache) ? dirMb(cache) : 0
    if (freed.nextCache > 0) rmRf(cache)
  }

  // 4) tmp scratch (only OUR patterns — never blind /tmp wipes)
  if (target === 'tmp' || target === 'all') {
    const tmp = '/tmp'
    const patterns = [/^ca-/, /^vite-/, /^cloud-agent-/, /^backup-/]
    let mb = 0
    try {
      for (const f of fs.readdirSync(tmp)) {
        if (!patterns.some((re) => re.test(f))) continue
        const full = path.join(tmp, f)
        try {
          const st = fs.statSync(full)
          const ageH = (Date.now() - st.mtimeMs) / 3600_000
          if (ageH < 1) continue // fresh scratch may still be in use
          mb += st.isDirectory() ? dirMb(full) : Math.round(st.size / (1024 * 1024))
          rmRf(full)
        } catch { /* raced with the owner process — skip */ }
      }
    } catch { /* no /tmp access — ignore */ }
    freed.tmp = mb
  }

  const totalMb = Object.values(freed).reduce((a, b) => a + (Number(b) || 0), 0)
  return NextResponse.json({ ok: true, freed, totalMb, target })
}
