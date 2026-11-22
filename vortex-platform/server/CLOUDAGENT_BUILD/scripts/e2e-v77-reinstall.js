/**
 * v77 reinstall E2E — sandbox restart wiped sdk/ again; SDKs reinstalled.
 * Proves the full stack still works end-to-end after the reinstall:
 *   1. Flutter (dart) project → auto-prep scaffolds web+android+ios+linux →
 *      flutter run web OK → preview 200 (via :81 gateway)
 *   2. C# (.NET) project → run OK → preview 200
 *   3. backend-nodeexpress template → run OK → /api/health JSON →
 *      user app 200 + admin app 200 via the SAME gateway path LivePreview uses
 *      (/?XTransformPort + /admin.html?XTransformPort) → CRUD → stop → trash
 *
 * Prereq: bun scripts/lock-dance.js backup   (caller restores after)
 */
const BASE = 'http://localhost:3000'
const GATE = 'http://localhost:81'
const fs = require('fs')

let cookie = ''
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0]
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}
let pass = 0, fail = 0
function check(label, cond, detail = '') {
  if (cond) { console.log('PASS ' + label); pass++ }
  else { console.error('FAIL ' + label + ' ' + String(detail).slice(0, 200)); fail++ }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function preview(path, port, timeoutMs = 8000) {
  try {
    const res = await fetch(GATE + path + '?XTransformPort=' + port, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    const text = await res.text()
    return { status: res.status, text, ct: res.headers.get('content-type') || '' }
  } catch (e) { return { status: 0, text: String(e), ct: '' } }
}

async function main() {
  // 0. temp PIN
  let s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: '737373' }) })
  if (s.body?.error && String(s.body.error).includes('already configured'))
    s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '737373' }) })
  check('lock temp PIN', s.status === 200 || s.status === 201, JSON.stringify(s.body).slice(0, 120))

  // ============ A. FLUTTER (with android scaffold) ============
  console.log('\n--- A. Flutter (web run + all-platform scaffold) ---')
  const fl = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v77-flutter-proof', language: 'dart' }) })
  check('flutter project created', fl.status === 200 && fl.body.project?.id, JSON.stringify(fl.body).slice(0, 150))
  const flId = fl.body.project?.id

  const flRun = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: flId, action: 'start' }) })
  check('flutter run ok (auto-prep: pub get + create platforms)', flRun.body?.ok === true, JSON.stringify(flRun.body).slice(0, 250))
  const flPort = flRun.body?.port

  if (flRun.body?.ok) {
    const scaffold = ['android/app/build.gradle.kts', 'android/app/src/main/AndroidManifest.xml', 'web/index.html', 'ios/Runner.xcodeproj/project.pbxproj', 'linux/CMakeLists.txt']
    let have = 0
    for (const f of scaffold) if (fs.existsSync('/home/z/my-project/projects/' + flId + '/' + f)) have++
    check('android+ios+linux+web scaffolds on disk (' + have + '/5)', have === 5)

    // first dart compile can take a few seconds — poll up to 60s
    let pv = { status: 0, text: '' }
    for (let i = 0; i < 12; i++) {
      await sleep(5000)
      pv = await preview('/', flPort, 15000)
      if (pv.status === 200) break
    }
    check('flutter preview 200 via gateway', pv.status === 200, 'status=' + pv.status)
    check('flutter serves real app', /flutter|Flutter/i.test(pv.text), pv.text.slice(0, 100))
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: flId, action: 'stop' }) })
  await api('/api/projects/' + flId, { method: 'DELETE' })

  // ============ B. C# (.NET) ============
  console.log('\n--- B. C# (.NET 8) ---')
  const cs = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v77-csharp-proof', language: 'csharp' }) })
  check('csharp project created', cs.status === 200 && cs.body.project?.id, JSON.stringify(cs.body).slice(0, 150))
  const csId = cs.body.project?.id
  const csRun = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: csId, action: 'start' }) })
  check('csharp run ok (dotnet restore + run)', csRun.body?.ok === true, JSON.stringify(csRun.body).slice(0, 250))
  if (csRun.body?.ok) {
    const pv = await preview('/', csRun.body.port, 8000)
    check('csharp preview 200', pv.status === 200, 'status=' + pv.status + ' ' + pv.text.slice(0, 80))
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: csId, action: 'stop' }) })
  await api('/api/projects/' + csId, { method: 'DELETE' })

  // ============ C. Node+Express FULL PRODUCT (user + admin preview) ============
  console.log('\n--- C. Express backend template (user app + admin app) ---')
  const ex = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v77-express-proof', templateId: 'backend-nodeexpress' }) })
  check('express project created', ex.status === 200 && ex.body.project?.id, JSON.stringify(ex.body).slice(0, 150))
  const exId = ex.body.project?.id
  const exRun = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: exId, action: 'start' }) })
  check('express run ok', exRun.body?.ok === true, JSON.stringify(exRun.body).slice(0, 250))
  if (exRun.body?.ok) {
    const port = exRun.body.port
    await sleep(800)
    const health = await preview('/api/health', port)
    check('GET /api/health JSON', health.status === 200 && /application\/json/.test(health.ct), health.status + ' ct=' + health.ct)
    const user = await preview('/', port)
    check('USER app preview 200 (gateway)', user.status === 200 && /Tasks|User App/i.test(user.text), user.status + ' ' + user.text.slice(0, 80))
    const admin = await preview('/admin.html', port)
    check('ADMIN app preview 200 (gateway, same path LivePreview probes)', admin.status === 200 && /Admin/i.test(admin.text), admin.status + ' ' + admin.text.slice(0, 80))
    check('admin page distinct from user page', admin.text !== user.text)
    // CRUD sanity
    const created = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: exId, action: 'exec', command: `curl -s -X POST http://localhost:${port}/api/items -H 'Content-Type: application/json' -d '{"name":"v77 item"}'` }) })
    check('POST /api/items works', /v77 item/.test(created.body?.stdout || created.body?.result || JSON.stringify(created.body)), JSON.stringify(created.body).slice(0, 150))
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: exId, action: 'stop' }) })
  await api('/api/projects/' + exId, { method: 'DELETE' })

  console.log(`\n==== ${pass} pass, ${fail} fail ====`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
