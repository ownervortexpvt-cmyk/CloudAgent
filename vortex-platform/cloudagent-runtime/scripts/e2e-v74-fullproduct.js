/**
 * v74 FULL-PRODUCT live agent E2E: one real agent build must ship
 * user app + admin app + backend server + README (the owner's #1 ask).
 * Creates a real project, streams /api/agent, inspects the file tree.
 * Prereq: lock in SETUP or PIN 737373 configured (lock-dance backup state).
 */
const fs = require('fs')
const BASE = 'http://localhost:3000'
let cookie = ''

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: text } }
}

let pass = 0, fail = 0
const check = (l, c, d = '') => { if (c) { console.log('PASS ' + l); pass++ } else { console.error('FAIL ' + l + ' ' + d); fail++ } }

/** Stream one agent turn; returns {ok, files: flat[]}. */
async function buildTurn(pid, providerId, prompt) {
  const res = await fetch(BASE + '/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ projectId: pid, prompt, providerId }),
  })
  if (!res.ok) {
    console.error('agent stream HTTP', res.status, (await res.text()).slice(0, 300))
    return { ok: false }
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', done = false, t0 = Date.now(), toolCalls = 0, okFlag = false
  const typeCounts = {}
  while (!done && Date.now() - t0 < 420000) {
    const { done: rd, value } = await reader.read()
    if (rd) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) {
      if (!l.trim()) continue
      let ev; try { ev = JSON.parse(l) } catch { continue }
      typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1
      if (ev.type === 'tool_call') toolCalls++
      if (ev.type === 'done') { done = true; okFlag = ev.ok !== false }
      if (ev.type === 'run_done' || ev.type === 'end') { done = true }
    }
  }
  console.log(`turn finished in ${Math.round((Date.now() - t0) / 1000)}s, tool_calls: ${toolCalls}, ok: ${okFlag}, types: ${JSON.stringify(typeCounts)}`)
  return { ok: okFlag }
}

function listFiles(pid) {
  return api(`/api/files/${pid}`).then(t => {
    const flat = []
    const walk = (n, pre) => {
      for (const c of (n.children || [])) {
        const p = pre ? pre + '/' + c.name : c.name
        if (c.type === 'dir') walk(c, p)
        else flat.push(p)
      }
    }
    walk(t.body.tree || {}, '')
    return flat
  })
}

async function main() {
  // auth (idempotent with 737373)
  let lk = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: '737373' }) })
  if (lk.body?.error && String(lk.body.error).includes('already configured')) {
    lk = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '737373' }) })
  }
  check('auth', lk.status === 200 || lk.status === 201, JSON.stringify(lk.body).slice(0, 100))

  // provider: built-in zai
  const provs = await api('/api/providers')
  const zai = (provs.body.providers || []).find(p => p.kind === 'zai' || p.kind === 'builtin')
  check('built-in provider present', !!zai, JSON.stringify(provs.body).slice(0, 120))

  // RESUME_PID=1 → skip creation + first build (continue an existing project)
  const resumePid = process.env.RESUME_PID || ''
  let pid
  if (resumePid) {
    pid = resumePid
    console.log('resuming existing project', pid)
  } else {
    const proj = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v74-fullproduct-proof', language: 'javascript' }) })
    pid = proj.body.project?.id
    check('project created', !!pid, JSON.stringify(proj.body).slice(0, 100))
    console.log('streaming agent build (multi-turn, up to 3 rounds)...')
    await buildTurn(pid, zai?.id, 'Build a small habit tracker app called HabitHero. Users track daily habits with streaks.')
  }

  // Continue turns until ALL FOUR parts exist (the owner's full-product rule).
  // Single-key upstream 429s can interrupt a turn — a follow-up message keeps
  // building on the same project (exactly what the UI chat does).
  const flat0 = await listFiles(pid)
  let flat = flat0
  for (let round = 2; round <= (resumePid ? 2 : 4); round++) {
    const hasUser = flat.some(f => /^(app|public|src)\//i.test(f))
    const hasAdmin = flat.some(f => /admin/i.test(f))
    const hasServer = flat.some(f => /(^|\/)(server|routes|api)\//i.test(f))
    const hasReadme = flat.some(f => /readme\.md$/i.test(f))
    if (hasUser && hasAdmin && hasServer && hasReadme) break
    const missing = [!hasUser && 'USER APP', !hasAdmin && 'ADMIN', !hasServer && 'SERVER', !hasReadme && 'README'].filter(Boolean).join(' ')
    console.log(`round ${round}: missing ${missing} — continuing...`)
    await new Promise(r => setTimeout(r, 45000)) // let the 429 window breathe
    await buildTurn(pid, zai?.id, `Continue the build — do NOT rebuild what exists. The FULL PRODUCT rule needs every part: user-facing UI (public/index.html), the admin panel (public/admin.html with its own admin login calling the admin API endpoints), backend server, and README.md wiring. Add ONLY what is missing: ${missing}.`)
    flat = await listFiles(pid)
  }

  console.log('file count:', flat.length)
  console.log('FILES ON DISK:\n' + flat.map(f => '  ' + f).join('\n'))

  const hasUser = flat.some(f => /^(app|public|src)\/(index|page|App|main)/i.test(f) || /^public\/index\.html$/.test(f) || /app\//i.test(f))
  const hasAdmin = flat.some(f => /admin/i.test(f))
  const hasServer = flat.some(f => /(^|\/)(server|routes|api)\//i.test(f) || /server\.(js|ts|cjs|mjs)$/.test(f))
  const hasReadme = flat.some(f => /readme\.md$/i.test(f))
  check('USER APP files present', hasUser, flat.join(', '))
  check('ADMIN APP files present', hasAdmin)
  check('BACKEND SERVER files present', hasServer)
  check('WIRING README present', hasReadme)

  // cleanup only when we own the project lifecycle
  if (!resumePid) await api('/api/projects/' + pid, { method: 'DELETE' })
  else console.log('KEEP project for further turns:', pid)
  console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('crash', e); process.exit(1) })
