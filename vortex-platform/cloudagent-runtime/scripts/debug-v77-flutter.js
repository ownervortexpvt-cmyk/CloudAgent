/** v77 flutter debug — why 502 after ok:start + which scaffold is missing */
const BASE = 'http://localhost:3000'
const GATE = 'http://localhost:81'
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
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  let s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: '737373' }) })
  if (s.body?.error && String(s.body.error).includes('already configured'))
    s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '737373' }) })
  const fl = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v77-flutter-debug', language: 'dart' }) })
  const id = fl.body.project?.id
  console.log('project', id)
  const run = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: id, action: 'start' }) })
  console.log('start →', JSON.stringify(run.body).slice(0, 300))
  const port = run.body?.port
  // poll logs + preview for up to 150s
  for (let i = 0; i < 30; i++) {
    await sleep(5000)
    const st = await api('/api/runtime?projectId=' + id)
    const rawLogs = st.body?.logs
    const logs = (Array.isArray(rawLogs) ? rawLogs.slice(-6) : String(rawLogs || '').split('\n').slice(-6)).join(' | ').slice(0, 400)
    let pv = { status: 0 }
    try { const r = await fetch(GATE + '/?XTransformPort=' + port, { signal: AbortSignal.timeout(4000) }); pv = { status: r.status } } catch {}
    console.log(`t=${(i + 1) * 5}s preview=${pv.status} status=${st.body?.status} logs: ${logs}`)
    if (pv.status === 200) { console.log('PREVIEW OK at t=' + (i + 1) * 5 + 's'); break }
  }
  // scaffold check
  const fs = require('fs')
  for (const f of ['android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml', 'web/index.html', 'ios/Runner.xcodeproj/project.pbxproj', 'linux/CMakeLists.txt'])
    console.log((fs.existsSync('/home/z/my-project/projects/' + id + '/' + f) ? 'HAVE ' : 'MISS ') + f)
  const root = fs.readdirSync('/home/z/my-project/projects/' + id).join(' ')
  console.log('root:', root)
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: id, action: 'stop' }) })
  await api('/api/projects/' + id, { method: 'DELETE' })
  console.log('cleaned')
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
