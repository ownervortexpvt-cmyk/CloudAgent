/**
 * v78 E2E — "Are ki lagbe add koro flutter react c# er jonno"
 * Sandbox restart wiped sdk/ AGAIN (3rd time) — everything reinstalled, PLUS
 * the missing pieces the owner listed: standalone Gradle 8.12, Kotlin kotlinc
 * 2.1.0, CMake 3.31.2, Android NDK r27c.
 *
 * Proves, through the REAL APIs:
 *   A. Flutter (dart): toolchain probes executed INSIDE the runtime env
 *      (gradle/kotlinc/cmake/NDK on PATH + ANDROID_NDK_HOME wired) → run →
 *      android/ios/linux/web scaffolds → preview 200 via :81 gateway
 *   B. React (vite): create → auto npm install → vite dev → preview 200
 *      serving the real SPA shell
 *   C. C# (.NET 8): create → dotnet restore/run → preview 200
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
    return { status: res.status, text }
  } catch (e) { return { status: 0, text: String(e) } }
}

async function execProbe(projectId, command) {
  const r = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId, action: 'exec', command, timeoutMs: 120000 }) })
  return { code: r.body?.code, out: (r.body?.stdout || '') + (r.body?.stderr || '') }
}

async function cleanupProject(id) {
  if (!id) return
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: id, action: 'stop' }) }).catch(() => {})
  await api('/api/projects/' + id, { method: 'DELETE' }).catch(() => {})
}

async function main() {
  // 0. temp PIN
  let s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: '737373' }) })
  if (s.body?.error && String(s.body.error).includes('already configured'))
    s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '737373' }) })
  check('lock temp PIN', s.status === 200 || s.status === 201, JSON.stringify(s.body).slice(0, 120))

  // ============ A. FLUTTER + FULL TOOLCHAIN (gradle/kotlin/cmake/NDK) ============
  console.log('\n--- A. Flutter + toolchain probes (inside runtime env) ---')
  const fl = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v78-flutter-proof', language: 'dart' }) })
  check('flutter project created', fl.status === 200 && fl.body.project?.id, JSON.stringify(fl.body).slice(0, 150))
  const flId = fl.body.project?.id

  // v78 toolchain probes — run in the EXACT env runtime.ts spawns (PATH + sdkEnv)
  const tg = await execProbe(flId, 'gradle --version 2>/dev/null | grep -m1 Gradle')
  check('gradle 8.12 on runtime PATH', tg.code === 0 && /Gradle 8\.12/.test(tg.out), `code=${tg.code} ${tg.out.slice(0, 80)}`)
  const tk = await execProbe(flId, 'kotlinc -version 2>&1')
  check('kotlinc 2.1.0 on runtime PATH', tk.code === 0 && /2\.1\.0/.test(tk.out), `code=${tk.code} ${tk.out.slice(0, 80)}`)
  const tc = await execProbe(flId, 'cmake --version | head -1')
  check('cmake 3.31.2 on runtime PATH', tc.code === 0 && /3\.31\.2/.test(tc.out), `code=${tc.code} ${tc.out.slice(0, 80)}`)
  const tn = await execProbe(flId, 'echo "NDK=$ANDROID_NDK_HOME"; test -f "$ANDROID_NDK_HOME/source.properties" && echo NDK-OK')
  check('ANDROID_NDK_HOME wired to r27c', tn.code === 0 && /NDK-OK/.test(tn.out) && /27\.2\.12479018/.test(tn.out), `code=${tn.code} ${tn.out.slice(0, 120)}`)

  const flRun = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: flId, action: 'start' }) })
  check('flutter run ok (auto-prep: pub get + platforms)', flRun.body?.ok === true, JSON.stringify(flRun.body).slice(0, 250))
  const flPort = flRun.body?.port
  if (flRun.body?.ok) {
    const scaffold = ['android/app/build.gradle.kts', 'android/app/src/main/AndroidManifest.xml', 'web/index.html', 'ios/Runner.xcodeproj/project.pbxproj', 'linux/CMakeLists.txt']
    let have = 0
    for (const f of scaffold) if (fs.existsSync('/home/z/my-project/projects/' + flId + '/' + f)) have++
    check('android+ios+linux+web scaffolds on disk (' + have + '/5)', have === 5)
    let pv = { status: 0, text: '' }
    for (let i = 0; i < 12; i++) {
      await sleep(5000)
      pv = await preview('/', flPort, 15000)
      if (pv.status === 200) break
    }
    check('flutter preview 200 via gateway', pv.status === 200, 'status=' + pv.status)
    check('flutter serves real app', /flutter|Flutter/i.test(pv.text), pv.text.slice(0, 100))
  }
  await cleanupProject(flId)

  // ============ B. REACT (vite + TS) ============
  console.log('\n--- B. React (vite) ---')
  const re = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v78-react-proof', language: 'react' }) })
  check('react project created', re.status === 200 && re.body.project?.id, JSON.stringify(re.body).slice(0, 150))
  const reId = re.body.project?.id
  const reRun = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: reId, action: 'start' }) })
  check('react run ok (npm install + vite dev)', reRun.body?.ok === true, JSON.stringify(reRun.body).slice(0, 250))
  if (reRun.body?.ok) {
    let pv = { status: 0, text: '' }
    for (let i = 0; i < 12; i++) {
      await sleep(5000)
      pv = await preview('/', reRun.body.port, 10000)
      if (pv.status === 200) break
    }
    check('react preview 200 via gateway', pv.status === 200, 'status=' + pv.status)
    check('react serves SPA shell (root + main.tsx + vite client)', /id="root"/.test(pv.text) && /src\/main\.tsx/.test(pv.text), pv.text.slice(0, 120))
  }
  await cleanupProject(reId)

  // ============ C. C# (.NET 8) ============
  console.log('\n--- C. C# (.NET 8) ---')
  const cs = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v78-csharp-proof', language: 'csharp' }) })
  check('csharp project created', cs.status === 200 && cs.body.project?.id, JSON.stringify(cs.body).slice(0, 150))
  const csId = cs.body.project?.id
  const csRun = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: csId, action: 'start' }) })
  check('csharp run ok (dotnet restore + run)', csRun.body?.ok === true, JSON.stringify(csRun.body).slice(0, 250))
  if (csRun.body?.ok) {
    const pv = await preview('/', csRun.body.port, 8000)
    check('csharp preview 200', pv.status === 200, 'status=' + pv.status + ' ' + pv.text.slice(0, 80))
  }
  await cleanupProject(csId)

  console.log(`\n===== RESULT: ${pass} PASS, ${fail} FAIL =====`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(1) })
