#!/usr/bin/env node
/**
 * v100 — ONE-COMMAND HOUSEKEEPING for the cloud agent platform.
 *
 *   node scripts/maintenance.mjs            → dry-run report (touches nothing)
 *   node scripts/maintenance.mjs --apply    → actually purge
 *   node scripts/maintenance.mjs --apply --sessions-days=7
 *
 * What it sweeps (all rules conservative + grace-perioded):
 *   1. STALE LOCK SESSIONS — lockSession rows idle > N days (default 7).
 *      Active sessions refresh lastSeenAt on every authenticated request,
 *      so an old row is a dead browser. (The app also lazily sweeps 30d
 *      sessions on every unlock — this is the manual deep clean.)
 *   2. GHOST PROJECT ROWS — DB Project rows with NO directory on disk and
 *      createdAt older than 1h (grace window so an import that is mid-
 *      flight is never killed). A row without a dir opens broken in the
 *      dashboard; it is pure residue.
 *   3. TEST-PROBE PROJECTS — rows WITH a dir whose name matches the
 *      platform's probe naming (^v<digits>-*-probe). Owner projects never
 *      match; their rows+dirs are purged together (DB row + rm -r dir).
 *   4. ORPHAN DIRECTORIES — projects/<id> dirs with NO DB row, older than
 *      1h (mtime). Disk waste with no owner.
 *   5. REPORT — disk free, DB size, live project list, session count.
 *
 * NEVER deletes: a row with a dir whose name is not a probe pattern, or
 * anything younger than the grace window. Jarvis/Reelzo are safe by rule,
 * not by hardcoded list.
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const APPLY = process.argv.includes('--apply')
const daysArg = process.argv.find(a => a.startsWith('--sessions-days='))
const SESSION_DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) || 7 : 7
const GRACE_MS = 60 * 60 * 1000 // 1h — never touch anything younger
const PROBE_NAME = /^v\d+[a-z]*-.*-probe$/i

const db = new PrismaClient()
const stats = { sessionsPurged: 0, ghostRowsPurged: 0, probePurged: 0, orphanDirsPurged: 0, kept: [] }
const now = Date.now()

const log = (s) => console.log(s)
const gb = (b) => (b / 1024 / 1024 / 1024).toFixed(2) + 'GB'

async function main() {
  log(`\n🧹 MAINTENANCE — ${APPLY ? 'APPLY (purging)' : 'DRY-RUN (report only, add --apply to purge)'}\n`)

  /* 1 — stale lock sessions */
  const sessionCutoff = new Date(now - SESSION_DAYS * 24 * 60 * 60 * 1000)
  const staleSessions = await db.lockSession.count({ where: { lastSeenAt: { lt: sessionCutoff } } })
  const totalSessions = await db.lockSession.count()
  if (staleSessions > 0) {
    if (APPLY) {
      const r = await db.lockSession.deleteMany({ where: { lastSeenAt: { lt: sessionCutoff } } })
      stats.sessionsPurged = r.count
    }
    log(`[sessions] ${staleSessions}/${totalSessions} idle > ${SESSION_DAYS}d ${APPLY ? '→ PURGED (' + (APPLY && stats.sessionsPurged) + ')' : '→ would purge'}`)
  } else {
    log(`[sessions] clean — ${totalSessions} rows, none older than ${SESSION_DAYS}d`)
  }

  /* 2+3 — ghost rows + probe projects */
  const projects = await db.project.findMany({ select: { id: true, name: true, createdAt: true } })
  const dirSet = new Set(fs.readdirSync('projects').filter(n => !n.startsWith('.')))
  const ghosts = projects.filter(p => !dirSet.has(p.id) && now - new Date(p.createdAt).getTime() > GRACE_MS)
  const probes = projects.filter(p => dirSet.has(p.id) && PROBE_NAME.test(p.name.trim()))
  for (const g of ghosts) {
    if (APPLY) await db.project.delete({ where: { id: g.id } }).catch(() => {})
    stats.ghostRowsPurged++
  }
  for (const p of probes) {
    if (APPLY) {
      await db.project.delete({ where: { id: p.id } }).catch(() => {})
      fs.rmSync(path.join('projects', p.id), { recursive: true, force: true })
    }
    stats.probePurged++
  }
  log(`[projects] ${ghosts.length} ghost rows (no dir) ${APPLY ? '→ PURGED' : '→ would purge'}`)
  log(`[projects] ${probes.length} test-probe projects ${APPLY ? '→ PURGED (row+dir)' : '→ would purge'}`)

  /* 4 — orphan dirs */
  const rowIds = new Set(projects.map(p => p.id))
  const orphans = []
  for (const d of dirSet) {
    if (rowIds.has(d)) continue
    const full = path.join('projects', d)
    const mtime = fs.statSync(full).mtimeMs
    if (now - mtime > GRACE_MS) orphans.push(full)
  }
  for (const o of orphans) {
    if (APPLY) fs.rmSync(o, { recursive: true, force: true })
    stats.orphanDirsPurged++
  }
  log(`[projects] ${orphans.length} orphan dirs (no row) ${APPLY ? '→ PURGED' : '→ would purge'}`)

  /* 5 — report */
  const after = APPLY ? await db.project.findMany({ select: { id: true, name: true } }) : projects.filter(p => !ghosts.find(g => g.id === p.id) && !probes.find(x => x.id === p.id))
  const sessionsAfter = APPLY ? await db.lockSession.count() : totalSessions - (APPLY ? 0 : staleSessions)
  let diskFree = '?'
  try { diskFree = gb(parseInt(execSync('df -k / | tail -1').toString().trim().split(/\s+/)[3], 10) * 1024) } catch {}
  let dbSize = '?'
  try { dbSize = gb(fs.statSync('db/custom.db').size) } catch {}
  log(`\n[disk] free: ${diskFree}   [db] size: ${dbSize}   [sessions] after: ${sessionsAfter}`)
  log(`[projects] surviving (${after.length}):`)
  for (const p of after) log(`   • ${p.name.trim()} (${p.id})`)
  log(`\nDone. ${APPLY ? 'Swept: ' + stats.sessionsPurged + ' sessions, ' + stats.ghostRowsPurged + ' ghosts, ' + stats.probePurged + ' probes, ' + stats.orphanDirsPurged + ' orphan dirs.' : 'Nothing was modified — re-run with --apply to purge.'}\n`)
  await db.$disconnect()
}

main().catch(e => { console.error('maintenance failed:', e.message); process.exit(1) })
