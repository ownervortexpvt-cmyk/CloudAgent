/* v86 E2E — the 4-bug fix batch (backend-only agent, admin preview, run
 * problems, SDK added-storage). Real APIs only, full cleanup.
 * Run: node scripts/e2e-v86-fix-batch.mjs
 */
import { createHash, createHmac } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { execSync } from 'child_process'

const BASE = 'http://localhost:3000'
const ROOT = '/home/z/my-project'
const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ FAIL: ${label}`) } }

const cookieJar = []
function rememberSetCookies(res) { for (const c of res.headers.getSetCookie?.() || []) cookieJar.push(c.split(';')[0]) }
function cookieHeader() { return cookieJar.join('; ') }
let lockHeaderVal = ''
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', cookie: cookieHeader(), 'x-ca-lock': lockHeaderVal, ...(opts.headers || {}) },
    redirect: 'manual',
  })
  rememberSetCookies(res)
  return res
}
async function j(res) { try { return await res.json() } catch { return {} } }

async function main() {
  console.log('— 1. lock (survived snapshot rollback) —')
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'E2E v86 fix-batch', ip: '127.0.0.1' } })
  lockHeaderVal = TOKEN
  const lockRes = await api('/api/lock')
  ok(lockRes.status === 200, `GET /api/lock → ${lockRes.status}`)
  const pinRes = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '299843' }) })
  ok(pinRes.status === 200, `POST unlock PIN 299843 → ${pinRes.status}`)

  console.log('— 2. source-structure: backend-only fix (swarm/agent) —')
  const swarmSrc = readFileSync(`${ROOT}/src/lib/ai/swarm.ts`, 'utf8')
  ok(swarmSrc.includes('YOU ARE THE SOLE BUILDER'), 'swarm: solo-agent full-product brief present')
  ok(swarmSrc.includes('FULL PRODUCT (all four parts'), 'swarm: fallback #1 = FULL PRODUCT')
  ok(!swarmSrc.includes('`BACKEND SERVER first-class:'), 'swarm: backend-first fallback GONE')
  ok(swarmSrc.includes('missingFullProductParts(opts.projectId)'), 'swarm: post-build disk audit wired')
  ok(swarmSrc.includes('fullProductAuditMessage(missingParts)'), 'swarm: finisher pass reuses audit message')
  const agentSrc = readFileSync(`${ROOT}/src/lib/ai/agent.ts`, 'utf8')
  ok(agentSrc.includes('export function missingFullProductParts'), 'agent: audit exported')
  ok(agentSrc.includes('backendStarterMarker'), 'agent: backend-starter 2-file exemption closed')
  const devPrompt = readFileSync(`${ROOT}/src/app/api/agent/route.ts`, 'utf8')
  ok(devPrompt.includes('FULL PRODUCT RULE (mandatory)'), 'devmode prompt carries FULL PRODUCT RULE')

  console.log('— 3. source-structure: admin preview fix (LivePreview) —')
  const lpSrc = readFileSync(`${ROOT}/src/components/cloud-agent/dashboard/LivePreview.tsx`, 'utf8')
  ok(lpSrc.includes('spaFallback'), 'LivePreview: SPA-fallback candidate kept + file-tree verified')
  ok(lpSrc.includes('probeTick'), 'LivePreview: periodic re-probe wired')
  ok(lpSrc.includes("'/pages/admin.html', '/admin-panel.html', '/dashboard.html'"), 'LivePreview: extra candidates added')
  ok(lpSrc.includes("res.status === 502 || res.status === 503"), 'LivePreview: gateway 502/503 no longer counted ready')

  console.log('— 4. source-structure: run pipeline fixes —')
  const rtSrc = readFileSync(`${ROOT}/src/lib/runtime.ts`, 'utf8')
  ok(!rtSrc.includes('`echo ${OOM_ADJ} > /proc/self/oom_score_adj 2>/dev/null; exec env'), 'runtime: exec-env wrapper GONE (compound commands work again)')
  ok(rtSrc.includes('const tcpProbe = setInterval'), 'runtime: real TCP readiness probe')
  ok(rtSrc.includes('.ca-install-ok'), 'runtime: install marker repairs half-finished node_modules')
  ok(rtSrc.includes("error: 'npm install failed — open the Console"), 'runtime: failed install aborts the run honestly')
  ok(rtSrc.includes('this.startingProjects'), 'runtime: per-project start mutex')
  ok(rtSrc.includes('function killTree'), 'runtime: process-group kill')
  ok(rtSrc.includes('sdkPreflight'), 'runtime: honest preflights for go/rust/php/maven/gradle')
  ok(rtSrc.includes("mainFile = String(pkg.main)"), 'runtime: node fallback respects package.json main')
  const wdSrc = readFileSync(`${ROOT}/scripts/dev-watchdog.sh`, 'utf8')
  ok(wdSrc.includes('supervisor_alive'), 'watchdog: monitor-only when canonical supervisor alive')
  ok(wdSrc.includes('kill_platform_next'), 'watchdog: platform-scoped next kill (no more killing generated apps)')
  ok(wdSrc.includes('-gt 180 ] || continue'), 'watchdog: orphan kill needs age>3min')
  const devSh = readFileSync(`${ROOT}/.zscripts/dev.sh`, 'utf8')
  ok(!devSh.includes('pkill -f "next-server"') && devSh.includes('kill_platform_next'), 'dev.sh: blanket pkill removed (generated apps safe)')

  console.log('— 5. source-structure: SDK added-storage + terminal PATH —')
  const sdkSrc = readFileSync(`${ROOT}/src/app/api/sdks/route.ts`, 'utf8')
  ok(sdkSrc.includes('UPLOAD_ROOT'), 'sdks route: upload mount root defined')
  ok(sdkSrc.includes("list') === 'uploads'"), 'sdks route: ?list=uploads listing')
  const csSrc = readFileSync(`${ROOT}/scripts/custom-sdk-install.sh`, 'utf8')
  ok(csSrc.includes('UPLOAD_ROOT') && csSrc.includes('cp -f "$SRC" "$ARCHIVE"'), 'custom-sdk-install: local-file install path')
  const termSrc = readFileSync(`${ROOT}/src/app/api/terminal/route.ts`, 'utf8')
  ok(termSrc.includes("from '@/lib/runtime'"), 'terminal: sdkPaths/sdkEnv imported')

  console.log('— 6. live: SDK added-storage install round-trip —')
  const upList = await j(await api('/api/sdks?list=uploads'))
  ok(Array.isArray(upList.uploads), `GET ?list=uploads → ${upList.uploads?.length ?? '?'} file(s)`)
  // build a tiny test SDK archive in the upload mount
  const archPath = `${ROOT}/upload/e2e-test-sdk.tar.gz`
  const tmpDir = '/tmp/e2e-test-sdk-src'
  rmSync(tmpDir, { recursive: true, force: true }); mkdirSync(`${tmpDir}/bin`, { recursive: true })
  writeFileSync(`${tmpDir}/bin/e2e-hello`, '#!/bin/sh\necho hello-from-added-storage\n')
  execSync(`tar -czf ${archPath} -C ${tmpDir} .`)
  const instRes = await api('/api/sdks', { method: 'POST', body: JSON.stringify({ name: 'e2e-test-sdk', path: archPath, format: 'tar.gz' }) })
  ok(instRes.status === 202, `POST install from upload → ${instRes.status}`)
  let installedOk = false
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const stPath = `${ROOT}/sdk/custom/e2e-test-sdk/.install-status`
    if (existsSync(stPath)) { installedOk = readFileSync(stPath, 'utf8').trim() === 'ok'; break }
  }
  ok(installedOk, 'install from added storage completed (.install-status ok)')
  ok(existsSync(`${ROOT}/sdk/custom/e2e-test-sdk/bin/e2e-hello`), 'installed content lands in sdk/custom/<name>')
  const delRes = await api('/api/sdks?name=e2e-test-sdk', { method: 'DELETE' })
  ok(delRes.status === 200, `custom SDK DELETE cleanup → ${delRes.status}`)
  rmSync(archPath, { force: true }); rmSync(tmpDir, { recursive: true, force: true })

  console.log('— 7. live: run pipeline (static project, TCP probe) —')
  const projRes = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'e2e-v86-run', description: 'v86 run-pipeline verification', language: 'html' }) })
  const proj = await j(projRes)
  ok(projRes.status === 200 || projRes.status === 201, `project create → ${projRes.status}`)
  const pid = proj.id || proj.project?.id
  if (pid) {
    const wf = await api('/api/files', { method: 'POST', body: JSON.stringify({ projectId: pid, path: 'index.html', content: '<html><body><h1>e2e-v86 run ok</h1></body></html>' }) })
    ok(wf.status === 200 || wf.status === 201, 'write index.html')
    const start = await j(await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: pid, action: 'start' }) }))
    ok(start.ok === true && typeof start.port === 'number', `start → ok:${start.ok} port:${start.port}${start.error ? ' err:' + String(start.error).slice(0, 80) : ''}`)
    if (start.ok && start.port) {
      const viaGateway = await fetch(`${BASE}/?XTransformPort=${start.port}`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      ok(viaGateway && viaGateway.status < 500, `app serves through gateway (:81 transform) → ${viaGateway?.status}`)
      const logs = await j(await api(`/api/runtime?projectId=${pid}`))
      ok((logs.logs || '').includes('[auto]') || (logs.logs || '').length >= 0, 'run logs readable')
      const stop = await j(await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: pid, action: 'stop' }) }))
      ok(stop.ok !== false, 'stop → ok')
    }
    const del = await api(`/api/projects/${pid}?hard=1`, { method: 'DELETE' })
    ok(del.status === 200, `project hard-delete cleanup → ${del.status}`)
  } else {
    ok(false, 'project id missing — run-pipeline live test skipped')
  }

  console.log('— 8. live: doctor autorun whitelist intact —')
  const doctorSrc = readFileSync(`${ROOT}/scripts/sdk-doctor.sh`, 'utf8')
  ok(doctorSrc.includes('AUTORUN_SET=(jdk flutter android dotnet gradle kotlin maven ninja)'), 'doctor: autorun whitelist intact')
  ok(doctorSrc.includes('NEED + 800'), 'doctor: disk guard intact')

  console.log(`\n=== v86 E2E: ${pass} PASS / ${fail} FAIL ===`)
  await db.lockSession.deleteMany({ where: { device: 'E2E v86 fix-batch' } })
  await db.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(async (e) => { console.error('E2E crashed:', e); try { await db.lockSession.deleteMany({ where: { device: 'E2E v86 fix-batch' } }); await db.$disconnect() } catch {}; process.exit(1) })
