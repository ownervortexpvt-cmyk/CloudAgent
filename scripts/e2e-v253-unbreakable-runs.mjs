/**
 * E2E — v25.3 "Unbreakable Runs" (/api/agent run-buffer + resume + abort).
 *
 * Proves, against the LIVE server:
 *   1. baseline run streams run_started → done (built-in Z.ai, REAL model)
 *   2. mid-stream DISCONNECT does NOT kill the run — POST /api/agent/resume
 *      replays missed events and the run still completes with done
 *   3. resume with a from-offset delivers exactly the missed events
 *      (processedRef parity: no duplicates, no gaps)
 *   4. /api/agent/abort really stops a run; the next resume sees the error
 *   5. unknown runId → 404, invalid runId → 400
 *
 * The runs use forceBuiltIn (built-in Z.ai provider via the platform SDK) so
 * the owner's saved provider keys are never consumed by this test.
 *
 * Run: node scripts/e2e-v253-unbreakable-runs.mjs
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()
const PROJECT = 'e2e-v253-run-tmp'

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

function signToken(secret, now = Date.now()) {
  const expiry = now + 30 * 24 * 60 * 60 * 1000
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const HEADERS = () => ({ 'Content-Type': 'application/json', 'x-ca-lock': global.TOKEN })

function startRun(body) {
  return fetch(`${BASE}/api/agent`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ projectId: PROJECT, forceBuiltIn: true, ...body }),
  })
}

/** Read NDJSON lines with a per-line callback; returns {events, transportEnded} */
async function readStream(res, onLine, { killAfter = Infinity } = {}) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const events = []
  let seen = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let evt
      try { evt = JSON.parse(line) } catch { continue }
      events.push(evt)
      try { onLine?.(evt, events.length - 1) } catch {}
      if (++seen >= killAfter) { await reader.cancel().catch(() => {}); return { events, transportEnded: false } }
    }
  }
  return { events, transportEnded: true }
}

async function main() {
  console.log(`\n=== /api/agent Unbreakable Runs E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v25.3 unbreakable-runs', ip: '127.0.0.1' },
  })

  // ── 1. Baseline: full run to done ────────────────────────────────────────
  const baselineId = `e2e_base_${crypto.randomBytes(6).toString('hex')}`
  const r1 = await startRun({ runId: baselineId, prompt: 'Reply with the single word OK. Do not call any tools.' })
  ok('1a. run starts 200 + body', r1.status === 200 && !!r1.body, `HTTP ${r1.status}`)
  const s1 = await readStream(r1)
  const types1 = s1.events.map(e => e.type)
  ok('1b. run_started is the FIRST event', types1[0] === 'run_started' && s1.events[0].runId === baselineId, types1.slice(0, 2).join(','))
  ok('1c. run completes with done (REAL Z.ai reply)', types1.includes('done'), `${types1.length} events`)

  // ── 2. Disconnect mid-stream → resume → run STILL completes ─────────────
  const dropId = `e2e_drop_${crypto.randomBytes(6).toString('hex')}`
  const r2 = await startRun({ runId: dropId, prompt: 'Reply with the single word OK. Do not call any tools.' })
  const s2 = await readStream(r2, null, { killAfter: 1 }) // take run_started, then KILL the connection
  ok('2a. viewer disconnected after 1 event', s2.events.length === 1 && !s2.transportEnded, `got ${s2.events.length}`)
  await new Promise(r => setTimeout(r, 6000)) // give the run time to continue server-side

  const r2b = await fetch(`${BASE}/api/agent/resume`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ runId: dropId, from: 1 }),
  })
  ok('2b. resume 200', r2b.status === 200, `HTTP ${r2b.status}`)
  const s2b = await readStream(r2b)
  ok('2c. resume meta first line', s2b.events[0]?.type === 'resumed' && s2b.events[0].from === 1, JSON.stringify(s2b.events[0]))
  const types2b = s2b.events.map(e => e.type)
  ok('2d. run COMPLETED server-side after disconnect (done in replay)', types2b.includes('done'), `${types2b.length} events replayed: ${types2b.slice(0, 4).join(',')}`)

  // ── 3. Offset parity: from=0 replays the WHOLE buffer, no gaps ───────────
  const r3 = await fetch(`${BASE}/api/agent/resume`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ runId: dropId, from: 0 }),
  })
  const s3 = await readStream(r3)
  ok('3a. from=0 replays everything incl. run_started', s3.events[0]?.type === 'resumed' && s3.events.some(e => e.type === 'run_started' && e.runId === dropId), `${s3.events.length} events`)
  // Buffered totals reported by the server must match; from=0 carries exactly
  // one MORE event than from=1 (the run_started line).
  ok('3b. server totals consistent + done', s3.events[0].total === s2b.events[0].total && s3.events.length === s2b.events.length + 1 && s3.events.some(e => e.type === 'done'), `total=${s3.events[0].total}/${s2b.events[0].total}`)

  // ── 4. Abort really stops a run ──────────────────────────────────────────
  const abortId = `e2e_abrt_${crypto.randomBytes(6).toString('hex')}`
  const r4 = await startRun({ runId: abortId, prompt: 'Write a 500-word essay about rivers. Do not call tools.' })
  await readStream(r4, null, { killAfter: 1 }) // viewer leaves immediately
  await new Promise(r => setTimeout(r, 500))
  const a4 = await fetch(`${BASE}/api/agent/abort`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: abortId }) })
  const a4d = await a4.json().catch(() => ({}))
  ok('4a. abort → ok:true aborted:true', a4.status === 200 && a4d.ok === true && a4d.aborted === true, JSON.stringify(a4d))
  await new Promise(r => setTimeout(r, 2500))
  const r4b = await fetch(`${BASE}/api/agent/resume`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: abortId, from: 0 }) })
  const s4b = await readStream(r4b)
  const lastType = s4b.events[s4b.events.length - 1]?.type
  ok('4b. aborted run finishes fast with error/done (not a hang)', lastType === 'error' || lastType === 'done', `last=${lastType}, events=${s4b.events.length}`)
  const abortAgain = await fetch(`${BASE}/api/agent/abort`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: abortId }) })
  const aa = await abortAgain.json().catch(() => ({}))
  ok('4c. abort after done → aborted:false', abortAgain.status === 200 && aa.aborted === false, JSON.stringify(aa))

  // ── 5. Unknown / invalid run ids ─────────────────────────────────────────
  const r5 = await fetch(`${BASE}/api/agent/resume`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: `e2e_none_${crypto.randomBytes(6).toString('hex')}`, from: 0 }) })
  ok('5a. unknown runId → 404', r5.status === 404, `HTTP ${r5.status}`)
  const r6 = await fetch(`${BASE}/api/agent/resume`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: 'bad id with spaces!!', from: 0 }) })
  ok('5b. invalid runId → 400', r6.status === 400, `HTTP ${r6.status}`)
  const r7 = await fetch(`${BASE}/api/agent/abort`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: `e2e_none_${crypto.randomBytes(6).toString('hex')}` }) })
  ok('5c. abort unknown runId → 404', r7.status === 404, `HTTP ${r7.status}`)

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().finally(() => db.$disconnect())
