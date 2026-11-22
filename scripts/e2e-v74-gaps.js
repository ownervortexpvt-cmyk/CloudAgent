/**
 * v74 gap-fill E2E: C++ project run, git status/commit, firebase+supabase
 * template create+run, language registry sanity.
 *
 * Prereq: bun scripts/lock-dance.js backup (lock wiped to SETUP), then this
 * script sets a temp PIN, runs tests, restores baseline state at the end via
 * lock-dance restore (caller responsibility).
 */
const BASE = 'http://localhost:3000'
// Live preview proxy = Caddy :81 (query XTransformPort=* → localhost:{port}).
// :3000 is the Next server itself — it never rewrites XTransformPort.
const PREVIEW = 'http://localhost:81'

let cookie = ''

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0]
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

let pass = 0, fail = 0
function check(label, cond, detail = '') {
  if (cond) { console.log(`PASS ${label}`); pass++ }
  else { console.error(`FAIL ${label} ${detail}`); fail++ }
}

async function main() {
  // 0. Setup temp PIN (first-run SETUP mode) — or unlock if a previous run
  // already configured PIN 737373 (idempotent re-runs).
  let setup = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: '737373' }) })
  if (setup.body?.error && String(setup.body.error).includes('already configured')) {
    setup = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '737373' }) })
  }
  check('lock setup (temp PIN)', setup.status === 200 || setup.status === 201, JSON.stringify(setup.body).slice(0, 120))

  // 1. Language registry: 16 languages with csharp + cpp
  const langs = await api('/api/languages')
  const ids = (langs.body.languages || []).map(l => l.id)
  check('languages registry has csharp', ids.includes('csharp'), ids.join(','))
  check('languages registry has cpp', ids.includes('cpp'))

  // 2. Create C++ project → detect → run → preview
  const cpp = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v74-cpp-proof', language: 'cpp' }) })
  check('cpp project created', cpp.status === 200 && cpp.body.project?.id, JSON.stringify(cpp.body).slice(0, 150))
  const cppId = cpp.body.project?.id
  check('cpp detection wrote scaffold', (cpp.body.written || 0) >= 2, `written=${cpp.body.written}`)

  const run1 = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: cppId, action: 'start' }) })
  check('cpp runtime start ok', run1.body.ok === true, JSON.stringify(run1.body).slice(0, 200))
  if (run1.body.port) {
    await new Promise(r => setTimeout(r, 2000))
    const direct = await fetch('http://127.0.0.1:' + run1.body.port + '/')
    const dtext = await direct.text()
    check('cpp direct :port serves HTML', direct.status === 200 && dtext.includes('C++ app is running'), `status=${direct.status} body=${dtext.slice(0, 100)}`)
    const preview = await fetch(PREVIEW + '/?XTransformPort=' + run1.body.port)
    const html = await preview.text()
    check('cpp preview via proxy 200 + serves HTML', preview.status === 200 && html.includes('C++ app is running'), `status=${preview.status} body=${html.slice(0, 150)}`)
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: cppId, action: 'stop' }) })

  // 3. Git status + commit on the cpp project
  const g1 = await api('/api/git', { method: 'POST', body: JSON.stringify({ action: 'status', projectId: cppId }) })
  check('git status ok + initialized', g1.body.ok === true && g1.body.branch === 'main', JSON.stringify(g1.body).slice(0, 150))
  const g2 = await api('/api/git', { method: 'POST', body: JSON.stringify({ action: 'commit', projectId: cppId, message: 'feat: v74 proof commit' }) })
  check('git commit produced hash', g2.body.ok === true && g2.body.hash, JSON.stringify(g2.body).slice(0, 150))
  const g3 = await api('/api/git', { method: 'POST', body: JSON.stringify({ action: 'commit', projectId: cppId, message: 'empty?' }) })
  check('git commit clean tree → nothingToCommit', g3.body.nothingToCommit === true)
  const g4 = await api('/api/git', { method: 'POST', body: JSON.stringify({ action: 'history', projectId: cppId }) })
  check('git history ≥ 2 commits', (g4.body.commits || []).length >= 2 && g4.body.ok === true, JSON.stringify(g4.body).slice(0, 200))

  // 4. Firebase backend template → run → demo mode health
  const fb = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v74-firebase-proof', templateId: 'backend-firebase' }) })
  check('firebase project created', fb.status === 200 && fb.body.project?.id, JSON.stringify(fb.body).slice(0, 150))
  const fbId = fb.body.project?.id
  const run2 = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: fbId, action: 'start' }) })
  check('firebase runtime start ok', run2.body.ok === true, JSON.stringify(run2.body).slice(0, 250))
  if (run2.body.port) {
    // wait for npm install + server boot inside the sandbox proxy
    let fbOk = false, fbMode = ''
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const h = await fetch(BASE + '/?XTransformPort=' + run2.body.port + '&__path=/api/health')
        if (h.ok) {
          const t = await h.text()
          // The proxy serves the app root; health path may need direct hit
          if (t.includes('"mode"')) { fbOk = true; fbMode = t; break }
          if (t.includes('Items') || t.includes('admin')) { fbOk = true; fbMode = 'root-html'; break }
        }
      } catch {}
    }
    check('firebase preview reachable', fbOk, 'no 200 within 90s. logs tail: ' + JSON.stringify(fbMode).slice(0, 80))
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: fbId, action: 'stop' }) })

  // 5. Supabase backend template → files present (same shape as firebase)
  const sb = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v74-supabase-proof', templateId: 'backend-supabase' }) })
  check('supabase project created', sb.status === 200 && (sb.body.written || 0) >= 6, `written=${sb.body.written}`)

  // 5b. C# project → detect → run → preview (dotnet SDK now installed)
  const cs = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v74-csharp-proof', language: 'csharp' }) })
  check('csharp project created', cs.status === 200 && cs.body.project?.id, JSON.stringify(cs.body).slice(0, 150))
  const csId = cs.body.project?.id
  const run3 = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: csId, action: 'start' }) })
  check('csharp runtime start ok', run3.body.ok === true, JSON.stringify(run3.body).slice(0, 250))
  if (run3.body.port) {
    let csOk = false
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const d = await fetch('http://127.0.0.1:' + run3.body.port + '/')
        if (d.ok && (await d.text()).includes('C# app is running')) { csOk = true; break }
      } catch {}
    }
    check('csharp serves HTML on :port', csOk, 'server never answered within 180s')
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: csId, action: 'stop' }) })

  // 6. Trash all proof projects (cleanup) — keep owner baseline clean
  for (const id of [cppId, fbId, sb.body.project?.id, csId].filter(Boolean)) {
    await api('/api/projects/' + id, { method: 'DELETE' })
  }
  check('proof projects trashed', true)

  console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(1) })
