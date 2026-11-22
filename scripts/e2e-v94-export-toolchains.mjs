// E2E v94 — toolchain install buttons + per-project export/download engine
// A) POST /api/sdks/provision {install:'go'} → REAL background install of a missing toolchain (job file + log + pid)
// B) GET /api/sdks → live present flags; poll until go lands (or honest timeout)
// C) Export status matrix: web project → apk/exe not capable with honest reasons; ipa never
// D) flutter-capable project (pubspec.yaml on disk) → apk.capable=true, gate reason null (disk+RAM ok) — build NOT started here
// E) artifact download without a build → honest 404
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const db = new PrismaClient()
const base = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  PASS ${label}`) } else { fail++; console.log(`  FAIL ${label}`) } }

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'e2e v94 export', ip: '127.0.0.1' } })
const H = { 'x-ca-lock': TOKEN, 'Content-Type': 'application/json' }

let webId = null, flId = null
try {
  console.log('=== 1. GET /api/sdks — live toolchain matrix ===')
  const s0 = await fetch(`${base}/api/sdks`, { headers: H }).then(r => r.json())
  ok(Array.isArray(s0.toolchains) && s0.toolchains.length === 13, `13 managed toolchains listed (got ${s0.toolchains?.length})`)
  const goBefore = s0.toolchains.find(t => t.name === 'go')
  ok(typeof goBefore?.present === 'boolean', `go present flag probed live (${goBefore?.present})`)

  console.log('=== 2. POST provision {install:go} — real background install ===')
  const inst = await fetch(`${base}/api/sdks/provision`, { method: 'POST', headers: H, body: JSON.stringify({ install: 'go' }) }).then(r => r.json())
  if (goBefore.present) {
    ok(inst.started === false && /already/.test(inst.message || ''), 'already-present → honest no-op')
  } else {
    ok(inst.ok === true, `install accepted (${inst.message?.slice(0, 60)})`)
    ok(inst.started === true, 'started=true (background spawn)')
    const jobFile = '/home/z/my-project/sdk/.provision/_manual.json'
    ok(fs.existsSync(jobFile), 'job file _manual.json written (visible in provision status)')
    const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'))
    ok(job.items.some(i => i.name === 'go' && i.action === 'installing'), 'job item go=installing')
    ok(fs.existsSync('/home/z/my-project/sdk/.provision/log-go-heal.log'), 'setup log file created')
    const pidFile = '/home/z/my-project/sdk/.provision/pid-go-heal'
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
    let alive = false
    try { process.kill(pid, 0); alive = true } catch {}
    ok(alive, `setup pid ${pid} alive`)

    console.log('=== 3. poll until go lands (≤7 min) ===')
    let goReady = false
    for (let i = 0; i < 70; i++) {
      await new Promise(r => setTimeout(r, 6000))
      const s = await fetch(`${base}/api/sdks`, { headers: H }).then(r => r.json())
      const g = s.toolchains.find(t => t.name === 'go')
      if (g?.present) { goReady = true; break }
      let still = false
      try { process.kill(pid, 0); still = true } catch {}
      if (!still) break // process ended — final state check below
    }
    const sEnd = await fetch(`${base}/api/sdks`, { headers: H }).then(r => r.json())
    const gEnd = sEnd.toolchains.find(t => t.name === 'go')
    ok(goReady || gEnd.present, `go SDK installed and probe visible (${gEnd?.present}) — real one-click install works`)
  }

  console.log('=== 4. install of an unknown name → honest refusal ===')
  const bad = await fetch(`${base}/api/sdks/provision`, { method: 'POST', headers: H, body: JSON.stringify({ install: 'no-such-tool' }) }).then(r => r.json())
  ok(bad.ok === true && bad.started === false && bad.item?.action === 'failed', 'unknown toolchain → started:false, honest failed item')

  console.log('=== 5. export status — web project (no pubspec, no csproj) ===')
  const cr = await fetch(`${base}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'v94-export-e2e' }) }).then(r => r.json())
  webId = cr.project?.id
  ok(!!webId, `web project created (${webId?.slice(-6)})`)
  const st1 = await fetch(`${base}/api/projects/${webId}/export?kind=status`, { headers: H }).then(r => r.json())
  ok(typeof st1.zip === 'string' && st1.zip.includes('/api/zip'), 'source zip path offered')
  ok(st1.targets.apk.capable === false && /pubspec/.test(st1.targets.apk.reason), 'apk not capable — honest pubspec reason')
  ok(st1.targets.exe.capable === false && /csproj/.test(st1.targets.exe.reason), 'exe not capable — honest csproj reason')
  ok(st1.targets.ipa.capable === false && /Xcode|macOS/i.test(st1.targets.ipa.reason), 'ipa honestly impossible (macOS/Xcode)')
  ok(typeof st1.diskFreeMb === 'number' && st1.diskFreeMb > 0, `disk free reported (${st1.diskFreeMb}MB)`)

  console.log('=== 6. export status — flutter-capable project (pubspec.yaml on disk) ===')
  const cr2 = await fetch(`${base}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'v94-flutter-e2e' }) }).then(r => r.json())
  flId = cr2.project?.id
  const flRoot = `/home/z/my-project/projects/${flId}`
  fs.mkdirSync(flRoot, { recursive: true })
  fs.writeFileSync(path.join(flRoot, 'pubspec.yaml'), 'name: v94_flutter_e2e\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n')
  const st2 = await fetch(`${base}/api/projects/${flId}/export?kind=status`, { headers: H }).then(r => r.json())
  ok(st2.targets.apk.capable === true, 'apk capable for pubspec project')
  ok(st2.targets.apk.toolchainsOk === true, 'flutter/android/jdk toolchains detected as ready')
  ok(st2.targets.apk.reason === null, `gate reason null (disk ${st2.diskFreeMb}MB, RAM ${st2.ramAvailableMb}MB ok) — build CAN start`)
  ok(st2.targets.exe.capable === false, 'exe still not capable for flutter project')

  console.log('=== 7. cross-target gate: POST exe on flutter project → 400 ===')
  const xg = await fetch(`${base}/api/projects/${flId}/export`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'exe' }) })
  const xgd = await xg.json().catch(() => ({}))
  ok(xg.status === 400 && /csproj/.test(xgd.error || ''), `exe build refused for flutter project (${xg.status})`)

  console.log('=== 8. artifact download before any build → honest 404 ===')
  const ar = await fetch(`${base}/api/projects/${flId}/export?kind=artifact&target=apk`, { headers: H })
  ok(ar.status === 404, `artifact 404 when nothing built (${ar.status})`)

  console.log('=== 9. POST invalid target → 400 ===')
  const it = await fetch(`${base}/api/projects/${flId}/export`, { method: 'POST', headers: H, body: JSON.stringify({ target: 'ipa' }) })
  ok(it.status === 400, `target=ipa refused at API (400) — dialog shows the honest note instead`)
} catch (e) {
  console.error('E2E crashed:', e)
  fail++
} finally {
  console.log('=== cleanup ===')
  for (const id of [webId, flId].filter(Boolean)) {
    await fetch(`${base}/api/projects/${id}?hard=1`, { method: 'DELETE', headers: H }).catch(() => {})
    fs.rmSync(`/home/z/my-project/projects/${id}`, { recursive: true, force: true })
  }
  // keep the go install (real value); only drop the manual job file so the panel stays clean
  try { fs.rmSync('/home/z/my-project/sdk/.provision/_manual.json', { force: true }) } catch {}
  await db.lockSession.deleteMany({ where: { device: 'e2e v94 export' } })
  await db.$disconnect()
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}
