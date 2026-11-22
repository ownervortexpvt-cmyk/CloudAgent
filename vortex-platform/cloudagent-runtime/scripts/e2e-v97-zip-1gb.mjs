// E2E v97 — zip import max size 1GB (owner spec) — streaming import engine
// A) small multipart zip → v92 parity (strip, binary disk-only, text in DB)
// B) 1GB zip STREAMED from python (no source on disk) → sha256-verified extraction, flat RAM
// C) 1.05GB raw stream → mid-stream 413 abort, zero temp residue, server healthy
// D) GET export still works (small path) after the rewrite
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readFileSync, existsSync, rmSync } from 'node:fs'

const db = new PrismaClient()
const base = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  PASS ${label}`) } else { fail++; console.log(`  FAIL ${label}`) } }

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
await db.lockSession.create({ data: { tokenHash: TOKEN_HASH, device: 'e2e v97 zip 1gb', ip: '127.0.0.1' } })
const H = { 'x-ca-lock': TOKEN }

function memAvailableMb() {
  try {
    const m = readFileSync('/proc/meminfo', 'utf8')
    return parseInt(m.match(/MemAvailable:\s+(\d+)/)[1], 10) / 1024
  } catch { return -1 }
}

function serverRssInfo() {
  try {
    const pid = execSync('pgrep -f "next dev" | head -1').toString().trim()
    const s = readFileSync(`/proc/${pid}/status`, 'utf8')
    return {
      rss: parseInt(s.match(/VmRSS:\s+(\d+)/)[1], 10) / 1024,
      hwm: parseInt(s.match(/VmHWM:\s+(\d+)/)[1], 10) / 1024,
    }
  } catch { return { rss: -1, hwm: -1 } }
}

function freeDiskMb() {
  try { return parseInt(execSync('df -k /').toString().trim().split('\n').pop().split(/\s+/)[3], 10) / 1024 } catch { return -1 }
}

/** self-heal: remove ANY v97 test residue (dirs, DB rows, dotfile temps) */
async function purgeResidue(tokenHash) {
  try {
    execSync("rm -rf /home/z/my-project/projects/.import-*.zip 2>/dev/null || true")
    const rows = await db.project.findMany({ where: { name: 'v97-zip-1gb-e2e' } })
    for (const p of rows) {
      try { execSync(`rm -rf /home/z/my-project/projects/${p.id}`) } catch {}
      await db.file.deleteMany({ where: { projectId: p.id } })
      await db.project.delete({ where: { id: p.id } }).catch(() => {})
    }
    if (tokenHash) await db.lockSession.deleteMany({ where: { tokenHash } })
  } catch {}
}

let projectId = null
try {
  console.log('=== 0. baseline ===')
  await purgeResidue(null)
  const diskBefore = freeDiskMb()
  ok(diskBefore > 1500, `disk headroom for the 1GB test (${diskBefore.toFixed(0)}MB free)`)

  console.log('=== 1. create project ===')
  const cr = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ name: 'v97-zip-1gb-e2e' }) })
  const crd = await cr.json()
  ok(!!crd.project?.id, `project created (${cr.status})`)
  projectId = crd.project?.id
  if (!projectId) throw new Error('no project id')
  const root = `/home/z/my-project/projects/${projectId}`

  console.log('=== 2. small multipart zip — v92 parity through the new streaming route ===')
  const zipA = new AdmZip()
  zipA.addFile('my-app/README.md', Buffer.from('# v97 streaming route parity'))
  const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  zipA.addFile('my-app/public/logo.png', PNG_1x1)
  zipA.addFile('my-app/src/lib/util.ts', Buffer.from('export const v97 = true\n'))
  const fd = new FormData()
  fd.append('file', new Blob([zipA.toBuffer()], { type: 'application/zip' }), 'small.zip')
  fd.append('projectId', projectId)
  const up = await fetch(`${base}/api/zip`, { method: 'POST', headers: H, body: fd })
  const upd = await up.json()
  ok(upd.ok === true && upd.imported === 3, `small import ok, imported===3 (got ${up.status}/${upd.imported})`)
  ok(existsSync(path.join(root, 'public/logo.png')), 'binary lands on disk (parity)')
  ok(existsSync(path.join(root, 'src/lib/util.ts')), 'nested text on disk (parity)')
  const dbRow = await db.file.findUnique({ where: { projectId_path: { projectId, path: 'README.md' } } })
  ok(dbRow?.content?.includes('v97'), 'text lands in DB (parity)')

  console.log('=== 3. THE 1GB STREAM — python builds a valid zip on the fly (no source on disk) ===')
  const boundary = 'castreamv97e2e'
  let sha = ''
  const rssBefore = serverRssInfo()
  const streamRes = spawnSync(
    `set -o pipefail; python3 scripts/stream-zip-multipart.py --mb 1024 --project-id ${projectId} --boundary ${boundary} 2>/tmp/v97sha.txt | curl -sS -X POST -H "Content-Type: multipart/form-data; boundary=${boundary}" -H "x-ca-lock: ${TOKEN}" --data-binary @- --max-time 900 ${base}/api/zip`,
    { shell: 'bash', encoding: 'utf8', timeout: 900_000, maxBuffer: 10 * 1024 * 1024 },
  )
  const rssAfter = serverRssInfo()
  try { sha = readFileSync('/tmp/v97sha.txt', 'utf8').match(/BIGSHA=([0-9a-f]+)/)[1] } catch {}
  ok(!!sha, `streamer produced payload hash (${(sha || 'none').slice(0, 12)}…)`)
  ok(streamRes.status === 0, `curl upload finished cleanly (exit ${streamRes.status})`)
  let big = {}
  try { big = JSON.parse(streamRes.stdout) } catch {}
  ok(big.ok === true, `1GB import ok (${JSON.stringify(big).slice(0, 120)})`)
  ok(big.imported === 4, `imported===4 (big.bin + readme + png + util.ts; got ${big.imported})`)

  console.log('=== 4. 1GB integrity — extracted bytes must match the streamed payload bit-for-bit ===')
  const bigPath = path.join(root, 'big/big.bin')
  ok(existsSync(bigPath), 'big/big.bin extracted on disk (top-level folder stripped)')
  const diskSha = existsSync(bigPath) ? createHash('sha256').update(fs.readFileSync(bigPath)).digest('hex') : 'missing'
  ok(diskSha === sha, 'sha256(extracted big.bin) === sha256(streamed payload) — BYTE-IDENTICAL')
  const bigSize = existsSync(bigPath) ? fs.statSync(bigPath).size : 0
  ok(bigSize === 1024 * 1024 * 1024, `big.bin is exactly 1GB (${(bigSize / 1024 / 1024).toFixed(0)}MB)`)
  ok(!await db.file.findFirst({ where: { projectId, path: 'big/big.bin' } }), '1GB binary NOT in DB (SQLite stays lean)')
  ok(!!await db.file.findUnique({ where: { projectId_path: { projectId, path: 'readme.txt' } } }).catch(() => null), 'small text in DB')
  ok(existsSync(path.join(root, 'assets/tiny.png')), 'png extracted from the streamed zip')
  ok(existsSync(path.join(root, 'nested/lib/util.ts')), 'nested ts extracted')
  const ramGrowth = rssAfter.hwm - rssBefore.rss
  ok(ramGrowth > 0 && ramGrowth < 600, `server RAM stayed flat during 1GB import (peak growth ${ramGrowth.toFixed(0)}MB — no body buffering)`)
  const tmpLeft = execSync(`ls -A ${JSON.stringify('/home/z/my-project/projects')} | grep -c '^\\.import-' || true`).toString().trim()
  ok(tmpLeft === '0', 'no .import-* temp residue')

  console.log('=== 5. CAP TEST — 1.05GB raw stream must abort mid-flight ===')
  const capRes = spawnSync(
    `python3 scripts/stream-zip-multipart.py --mb ${1024 + 51} --project-id ${projectId} --boundary ${boundary} --cap-test | curl -sS -X POST -H "Content-Type: multipart/form-data; boundary=${boundary}" -H "x-ca-lock: ${TOKEN}" --data-binary @- --max-time 900 ${base}/api/zip`,
    { shell: 'bash', encoding: 'utf8', timeout: 900_000, maxBuffer: 10 * 1024 * 1024 },
  )
  const capOut = (capRes.stdout || '') + (capRes.stderr || '')
  const capRejected = capRes.status !== 0 || /413|too large/i.test(capOut)
  ok(capRejected, `oversize upload rejected (exit ${capRes.status}, out: ${capOut.slice(0, 140).replace(/\n/g, ' ')})`)
  const tmpLeft2 = execSync(`ls -A ${JSON.stringify('/home/z/my-project/projects')} | grep -c '^\\.import-' || true`).toString().trim()
  ok(tmpLeft2 === '0', 'temp cleaned after cap abort (no .import-*)')
  const health = await fetch(`${base}/api/sdks`, { headers: H }).then(r => r.status).catch(() => 0)
  ok(health === 200, `server healthy after abort ${health})`)
  const dbStill = await db.project.findUnique({ where: { id: projectId } })
  ok(!!dbStill, 'project row intact after aborted upload')

  console.log('=== 6. GET export — big project takes the streaming CLI path; verify without buffering 1GB in the TEST ===')
  const ex = await fetch(`${base}/api/zip?projectId=${projectId}`, { headers: H })
  ok(ex.status === 200 && (ex.headers.get('content-type') || '').includes('zip'), `export zip ok (${ex.status})`)
  // read only the first chunk (local-file-header magic) then cancel — the
  // full 1.1GB stream must never sit in the test's RAM either
  const reader = ex.body.getReader()
  const first = await reader.read()
  const magic = first.value?.[0] === 0x50 && first.value?.[1] === 0x4b
  ok(magic, 'export stream begins with a zip local-header signature (PK)')
  await reader.cancel().catch(() => {})

  console.log('=== cleanup ===')
  rmSync(root, { recursive: true, force: true })
  await db.project.delete({ where: { id: projectId } }).catch(() => {})
  await db.file.deleteMany({ where: { projectId } })
  await db.lockSession.deleteMany({ where: { tokenHash: TOKEN_HASH } })
  const diskAfter = freeDiskMb()
  ok(diskAfter > diskBefore - 200, `disk recovered after cleanup (${diskAfter.toFixed(0)}MB vs ${diskBefore.toFixed(0)}MB before)`)
  projectId = null
} catch (e) {
  console.error('FATAL', e)
  fail++
  if (projectId) {
    try {
      rmSync(`/home/z/my-project/projects/${projectId}`, { recursive: true, force: true })
      await db.project.delete({ where: { id: projectId } }).catch(() => {})
      await db.file.deleteMany({ where: { projectId } })
    } catch {}
  }
} finally {
  await db.lockSession.deleteMany({ where: { tokenHash: TOKEN_HASH } })
  await db.$disconnect()
}
console.log(`\n=== v97 zip-1GB E2E: ${pass} pass / ${fail} fail ===`)
process.exit(fail ? 1 : 0)
