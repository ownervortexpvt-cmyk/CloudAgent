/**
 * v124-2 — ORPHAN PROJECT DIRECTORY CLEANUP
 *
 * The v123 cleanup hard-deleted every test project ROW from the DB
 * ("DB keeps ONLY owner + qa-admin115"), but the on-disk workspace dirs
 * under projects/ were left behind — 152 orphan folders burning disk.
 *
 * Safety: a dir is deleted ONLY when no Project row with that id exists.
 * Anything still referenced by the DB is never touched.
 * Run with --apply to actually delete; without it, dry-run only.
 */
const fs = require('fs')
const path = require('path')

const APPLY = process.argv.includes('--apply')
const ROOT = '/home/z/my-project/projects'

async function main() {
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()
  const live = new Set(
    (await prisma.project.findMany({ select: { id: true } })).map((p) => p.id)
  )
  await prisma.$disconnect()

  let totalBytes = 0
  let removed = 0
  let kept = 0
  const orphans = []

  function sizeOf(dir) {
    let n = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) n += sizeOf(p)
      else n += fs.statSync(p).size
    }
    return n
  }

  for (const name of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, name)
    if (!fs.statSync(full).isDirectory()) continue
    if (live.has(name)) { kept++; continue }
    orphans.push(name)
  }

  for (const name of orphans) {
    const full = path.join(ROOT, name)
    try { totalBytes += sizeOf(full) } catch {}
    if (APPLY) {
      try { fs.rmSync(full, { recursive: true, force: true }); removed++ } catch (e) {
        console.error('  ! failed', name, e.message)
      }
    }
  }

  console.log(`live-project dirs kept : ${kept}`)
  console.log(`orphan dirs found      : ${orphans.length}`)
  console.log(`orphan disk size       : ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
  if (APPLY) console.log(`orphan dirs removed    : ${removed}`)
  else console.log('DRY RUN — rerun with --apply to delete')
}

main().catch((e) => { console.error(e); process.exit(1) })
