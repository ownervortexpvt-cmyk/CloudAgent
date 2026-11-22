/**
 * v77 new-SDK E2E — proves Go / PHP / Rust / Java(Spring) runtimes work via
 * the REAL platform APIs (create → detect → run → preview → cleanup).
 * Usage: bun scripts/e2e-v77-langs.js go php     (space-separated subset)
 */
const BASE = 'http://localhost:3000'
const GATE = 'http://localhost:81'
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['go', 'php', 'rust', 'java']
const LANGS = {
  go: { name: 'v77-go-proof', id: 'go', expect: /Go server running/i, wait: 10, polls: 8 },
  php: { name: 'v77-php-proof', id: 'php', expect: /PHP app is running/i, wait: 3, polls: 8 },
  rust: { name: 'v77-rust-proof', id: 'rust', expect: /Rust server running/i, wait: 10, polls: 24 },
  java: { name: 'v77-java-proof', id: 'java', expect: /Java Spring Boot app is running/i, wait: 15, polls: 24 },
}
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
  else { console.error('FAIL ' + label + ' ' + String(detail).slice(0, 250)); fail++ }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  let s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: '737373' }) })
  if (s.body?.error && String(s.body.error).includes('already configured'))
    s = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: '737373' }) })
  check('lock temp PIN', s.status === 200 || s.status === 201, JSON.stringify(s.body).slice(0, 120))

  for (const t of targets) {
    const L = LANGS[t]
    if (!L) { console.error('unknown target ' + t); continue }
    console.log(`\n--- ${t.toUpperCase()} ---`)
    const cr = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: L.name, language: L.id }) })
    check(`${t} project created`, cr.status === 200 && cr.body.project?.id, JSON.stringify(cr.body).slice(0, 150))
    const id = cr.body.project?.id
    const run = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: id, action: 'start' }) })
    check(`${t} run ok`, run.body?.ok === true, JSON.stringify(run.body).slice(0, 250))
    if (run.body?.ok) {
      const port = run.body.port
      let pv = { status: 0, text: '' }
      await sleep(L.wait * 1000)
      for (let i = 0; i < L.polls; i++) {
        try {
          const r = await fetch(GATE + '/?XTransformPort=' + port, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
          pv = { status: r.status, text: await r.text() }
        } catch (e) { pv = { status: 0, text: String(e) } }
        if (pv.status === 200 && L.expect.test(pv.text)) break
        await sleep(5000)
      }
      check(`${t} preview 200 via gateway`, pv.status === 200, 'status=' + pv.status)
      check(`${t} serves real app`, L.expect.test(pv.text || ''), (pv.text || '').slice(0, 100))
    }
    await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: id, action: 'stop' }) })
    await api('/api/projects/' + id, { method: 'DELETE' })
  }
  console.log(`\n==== ${pass} pass, ${fail} fail ====`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
