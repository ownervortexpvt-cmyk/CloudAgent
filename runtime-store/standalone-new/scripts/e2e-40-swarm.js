/**
 * E2E proof: 40 agents added at once + 40 agents working simultaneously.
 * Run:  bun scripts/e2e-40-swarm.js start   (background, long)
 *       bun scripts/e2e-40-swarm.js status  (poll progress)
 */
const fs = require('fs')
const BASE = 'http://localhost:3000'
const DIR = '/home/z/my-project/scripts/.e2e'
const COOKIE = `${DIR}/cookie.txt`
const NDJSON = `${DIR}/swarm.ndjson`
const STATE = `${DIR}/state.json`
const PIN = '246810'

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (fs.existsSync(COOKIE)) headers.Cookie = fs.readFileSync(COOKIE, 'utf8')
  const res = await fetch(BASE + path, { ...opts, headers })
  const sc = res.headers.get('set-cookie')
  if (sc) fs.writeFileSync(COOKIE, sc.split(';')[0])
  return res
}

async function start() {
  fs.mkdirSync(DIR, { recursive: true })
  if (fs.existsSync(COOKIE)) fs.unlinkSync(COOKIE)

  // 1. auth — fresh setup OR unlock (already-configured lock from a prior run)
  let r = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'setup', pin: PIN }) })
  let lock = await r.json()
  if (!lock.ok) {
    r = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: PIN }) })
    lock = await r.json()
  }
  if (!lock.ok && !lock.token) throw new Error('lock auth failed: ' + JSON.stringify(lock))

  // 2. create 40 agents (zai built-in — no external keys needed)
  const before = await (await api('/api/providers')).json()
  const nBefore = (before.providers || []).length
  const created = []
  for (let i = 1; i <= 40; i++) {
    const name = `SwarmTest-${String(i).padStart(2, '0')}`
    const rr = await api('/api/providers', { method: 'POST', body: JSON.stringify({ name, kind: 'zai', model: 'glm-4.6', temperature: 0.7 }) })
    const d = await rr.json()
    if (!d.provider) throw new Error(`agent ${name} failed: HTTP ${rr.status} ${JSON.stringify(d).slice(0, 150)}`)
    created.push(d.provider.id)
    if (i % 10 === 0) console.log(`  agents created: ${i}/40`)
  }
  const after = await (await api('/api/providers')).json()
  console.log(`AGENTS: before=${nBefore} after=${(after.providers || []).length} (+40 created)`)

  // 3. create the proof project (javascript template → real scaffold context)
  r = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Swarm-40 Proof', language: 'javascript', description: '40 agents at once — live proof' }) })
  const proj = await r.json()
  if (!proj.project) throw new Error('project create failed: ' + JSON.stringify(proj).slice(0, 200))
  const projectId = proj.project.id
  console.log('PROJECT:', projectId)

  // 4. fire the swarm (NDJSON stream → file). The run survives disconnects server-side.
  const prompt = `Build a tiny module pack under swarm-out/: every agent writes ONE standalone CommonJS file swarm-out/mod-<work-package-number>.js that exports one unique small pure function (e.g. math/string util) with a one-line JSDoc comment. Use your OWN work package number in the filename so files never collide. Finally write swarm-out/README.md listing the modules. Keep every file under 20 lines.`
  fs.writeFileSync(NDJSON, '')
  const res = await fetch(BASE + '/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: fs.readFileSync(COOKIE, 'utf8') },
    body: JSON.stringify({ projectId, prompt, runId: 'swarm40_proof' }),
  })
  console.log('SWARM STREAM HTTP:', res.status)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const fd = fs.openSync(NDJSON, 'w')
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const l of lines) { if (l.trim()) fs.writeSync(fd, l + '\n') }
  }
  if (buf.trim()) fs.writeSync(fd, buf + '\n')
  fs.closeSync(fd)
  fs.writeFileSync(STATE, JSON.stringify({ projectId, agents: created, finishedAt: Date.now() }))
  console.log('SWARM STREAM CLOSED — full log at', NDJSON)
}

function status() {
  if (!fs.existsSync(NDJSON)) { console.log('no stream yet'); return }
  const txt = fs.readFileSync(NDJSON, 'utf8')
  const lines = txt.split('\n').filter(Boolean)
  let lastSwarm = null, done = false, plan = ''
  for (const l of lines) {
    try {
      const e = JSON.parse(l)
      if (e.type === 'swarm') { lastSwarm = e; if (e.plan) plan = e.plan.slice(0, 100) }
      if (e.type === 'done') { done = true }
    } catch {}
  }
  if (!lastSwarm) { console.log(`events=${lines.length} phase=starting…`); return }
  const a = lastSwarm.agents || []
  const c = s => a.filter(x => x.status === s).length
  const building = a.filter(x => x.status === 'building').map(x => x.name)
  console.log(`events=${lines.length} phase=${lastSwarm.phase} total=${a.length} pending=${c('pending')} building=${c('building')} done=${c('done')} failed=${c('failed')} ${done ? '★RUN-DONE' : '…running'}`)
  if (building.length) console.log('  now building:', building.slice(0, 8).join(', '), building.length > 8 ? `+${building.length - 8} more` : '')
}

const mode = process.argv[2] || 'status'
;(mode === 'start' ? start() : Promise.resolve()).then(() => { if (mode !== 'start') status() }).catch(e => { console.error('FATAL:', e.message); process.exit(1) })
