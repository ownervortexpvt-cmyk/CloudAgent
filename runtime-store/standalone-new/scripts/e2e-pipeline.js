/**
 * Pipeline E2E: prompt → code-gen → files → versions(git-like) → secrets →
 * backend/server runtime preview(:4000) → test publish(web).
 * Run: bun scripts/e2e-pipeline.js
 */
const fs = require('fs')
const BASE = 'http://localhost:3000'
const DIR = '/home/z/my-project/scripts/.e2e'
const COOKIE_FILE = `${DIR}/cookie.txt`
const NDJSON = `${DIR}/pipeline.ndjson`
const PIN = '246810'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function readCookie() {
  if (!fs.existsSync(COOKIE_FILE)) return ''
  const raw = fs.readFileSync(COOKIE_FILE, 'utf8').trim()
  if (raw.startsWith('#')) {
    // Netscape format (curl -c) — extract the ca_lock value
    for (const line of raw.split('\n')) {
      if (line.includes('ca_lock\t')) return 'ca_lock=' + line.split('\t').pop().trim()
    }
    return ''
  }
  return raw.includes('ca_lock=') ? raw : (raw ? 'ca_lock=' + raw : '')
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  const ck = readCookie()
  if (ck) headers.Cookie = ck
  const res = await fetch(BASE + path, { ...opts, headers })
  const sc = res.headers.get('set-cookie')
  if (sc) fs.writeFileSync(COOKIE_FILE, sc.split(';')[0])
  return res
}

async function auth() {
  let r = await api('/api/lock', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: PIN }) })
  const j = await r.json()
  if (!j.ok && !j.token) throw new Error('unlock failed: ' + JSON.stringify(j))
}

/** Consume an NDJSON agent stream until 'done' (max ~6 min). */
async function runAgent(body, outFile) {
  const res = await api('/api/agent', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error('agent HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200))
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', doneEvt = null
  const fd = fs.openSync(outFile, 'w')
  const t0 = Date.now()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (Date.now() - t0 > 360_000) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) {
      if (!l.trim()) continue
      fs.writeSync(fd, l + '\n')
      try {
        const e = JSON.parse(l)
        if (e.type === 'done') doneEvt = e
      } catch {}
    }
  }
  fs.closeSync(fd)
  return doneEvt
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true })
  await auth()

  // 1. project (javascript → Node backend scaffold)
  let r = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Pipeline Proof', language: 'javascript', description: 'full pipeline live proof' }) })
  const proj = (await r.json()).project
  if (!proj) throw new Error('project create failed')
  console.log('PROJECT:', proj.id)

  // 2. PROMPT → CODE GENERATION (single built-in agent, real files)
  const prompt = `Build a tiny but REAL Node.js backend app (NO npm dependencies — plain node:http):
1. server.js — HTTP server on process.env.PORT || 4000. Routes:
   - GET /api/hello → JSON {"ok":true,"app":"pipeline-proof"}
   - GET /api/secret → JSON {"secret": process.env.APP_SECRET || "not-set"} (proves secrets reach the runtime)
   - GET / → serves public/index.html
2. public/index.html — small page with a button that fetches /api/hello and shows the reply.
3. package.json — {"name":"pipeline-proof","start":"node server.js"}.
Write the 3 files with write_file. Keep them small and correct.`
  const t0 = Date.now()
  const done = await runAgent({ projectId: proj.id, prompt, forceBuiltIn: true, runId: 'pipeline_proof' }, NDJSON)
  console.log(`CODEGEN: done=${!!done} ok=${done?.ok} in ${Math.round((Date.now() - t0) / 1000)}s — ${(done?.content || '').slice(0, 100)}`)

  // 3. FILES on disk
  await sleep(1500)
  r = await api(`/api/files?projectId=${proj.id}`)
  const files = await r.json()
  const paths = (files.files || files.tree || []).map(f => f.path || f)
  console.log('FILES API:', JSON.stringify(paths))

  // 4. VERSIONS (git-like snapshot)
  r = await api('/api/versions', { method: 'POST', body: JSON.stringify({ projectId: proj.id, action: 'snapshot', label: 'pre-publish proof' }) })
  const snap = await r.json()
  console.log('VERSION SNAPSHOT:', snap.ok ? `ok (${snap.snapshot?.id || snap.snapshot?.label || 'saved'})` : JSON.stringify(snap).slice(0, 120))
  r = await api(`/api/versions?projectId=${proj.id}`)
  const vlist = await r.json()
  console.log('VERSION LIST:', (vlist.versions || []).length, 'snapshot(s)')

  // 5. SECRETS
  r = await api('/api/secrets', { method: 'POST', body: JSON.stringify({ key: 'APP_SECRET', value: 'pipeline-s3cr3t-42', isSecret: true }) })
  const sec = await r.json()
  console.log('SECRET SAVE:', sec.ok ? `ok masked=${sec.masked}` : JSON.stringify(sec).slice(0, 120))
  r = await api('/api/secrets')
  const secList = await r.json()
  const found = (secList.secrets || secList.items || []).some(s => (s.key || '').includes('APP_SECRET'))
  console.log('SECRET LIST:', found ? 'APP_SECRET present (value hidden)' : JSON.stringify(secList).slice(0, 120))

  // 6. RUNTIME PREVIEW (real server on :4000)
  r = await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: proj.id, action: 'start' }) })
  const start = await r.json()
  console.log('RUNTIME START:', JSON.stringify(start).slice(0, 160))
  let hello = null, secretSeen = null
  for (let i = 0; i < 20; i++) {
    await sleep(1500)
    try {
      const h = await fetch('http://localhost:4000/api/hello', { signal: AbortSignal.timeout(3000) })
      if (h.ok) { hello = await h.json(); break }
    } catch {}
  }
  if (hello) {
    try { const s = await fetch('http://localhost:4000/api/secret', { signal: AbortSignal.timeout(3000) }); secretSeen = await s.json() } catch {}
  }
  console.log('PREVIEW /api/hello:', hello ? JSON.stringify(hello) : 'FAILED (no 200 in 30s)')
  console.log('PREVIEW /api/secret:', secretSeen ? JSON.stringify(secretSeen) : 'n/a')

  // 7. TEST PUBLISH (web target)
  r = await api('/api/publish', { method: 'POST', body: JSON.stringify({ projectId: proj.id, target: 'web' }) })
  const pub = await r.json()
  console.log('PUBLISH:', JSON.stringify(pub).slice(0, 300))
  if (pub.build?.id) {
    for (let i = 0; i < 20; i++) {
      await sleep(2000)
      const b = await dbBuild(proj.id)
      if (b && b.status !== 'running') { console.log(`PUBLISH BUILD: ${b.status} in ~${(i + 1) * 2}s`); break }
    }
  }
  await api('/api/runtime', { method: 'POST', body: JSON.stringify({ projectId: proj.id, action: 'stop' }) }).catch(() => {})
  console.log('PIPELINE-RESULT', JSON.stringify({ projectId: proj.id, codegen: !!done?.ok, hello, secretSeen }))
}

async function dbBuild(projectId) {
  const { PrismaClient } = require('@prisma/client')
  const p = new PrismaClient()
  try { return await p.build.findFirst({ where: { projectId }, orderBy: { startedAt: 'desc' } }) } finally { await p.$disconnect() }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
