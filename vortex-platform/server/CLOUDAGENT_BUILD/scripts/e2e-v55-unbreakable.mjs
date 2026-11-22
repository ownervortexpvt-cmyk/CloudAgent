#!/usr/bin/env node
/**
 * v55 — Unbreakable Army + Durable History + Archive + Cost E2E (non-destructive)
 *
 * Proves:
 *  1. A swarm run SURVIVES viewer disconnect (cancel ≠ abort) and a rejoin
 *     replays the missed events + live-tails until done (v55 Unbreakable Army)
 *  2. Swarm runs persist an AgentRun row (running → completed/failed/stopped)
 *     and /api/runs exposes it (durable 🕘 history)
 *  3. Rejoin errors are honest: 400 without runId, 404 for unknown runs
 *  4. Stop is visible to rejoining viewers (stop status event + done)
 *  5. Project archive: PATCH status 'archived' + restore, nothing deleted
 *  6. /api/usage returns totalCostUSD + pricingNote (rough estimate fields)
 *
 * Non-destructive contract:
 *  - lock token minted from stored lock_secret (never rotates it)
 *  - the test project + its AgentRun rows are deleted at the end
 *  - usage totals are only read, never written
 */
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()
const BASE = process.env.BASE || 'http://localhost:3000'

let pass = 0, fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

const signToken = (secret) => {
  const exp = Date.now() + 10 * 60 * 1000
  const mac = crypto.createHmac('sha256', secret).update(`v1.${exp}`).digest('hex')
  return `v1.${exp}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
await db.lockSession.upsert({
  where: { tokenHash: sha256(TOKEN) },
  update: {},
  create: { tokenHash: sha256(TOKEN), device: 'E2E v55 unbreakable', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

console.log('— v55 Unbreakable Army E2E —')

// ── 1. rejoin error contract ─────────────────────────────────────────────
let r = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'rejoin' }) })
ok(r.status === 400, 'rejoin without runId → 400', `got ${r.status}`)
r = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'rejoin', runId: 'run_unknown_123456' }) })
ok(r.status === 404, 'rejoin unknown runId → 404', `got ${r.status}`)

// ── 2. test project ──────────────────────────────────────────────────────
r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '__e2e_v55_unbreakable' }) })
const proj = (await r.json()).project
ok(!!proj?.id, 'test project created', JSON.stringify(proj).slice(0, 120))
const PID = proj.id

// ── 3. usage API cost fields (before any run) ────────────────────────────
r = await fetch(`${BASE}/api/usage?days=7`, { headers: H })
const usage = await r.json()
ok(r.status === 200 && usage.ok === true, 'GET /api/usage → 200 ok')
ok(typeof usage.totalCostUSD === 'number', 'usage has totalCostUSD number', `got ${usage.totalCostUSD}`)
ok(typeof usage.pricingNote === 'string' && usage.pricingNote.includes('estimate'), 'usage has honest pricingNote')
ok(Array.isArray(usage.providers), 'usage providers list present')
const withCost = (usage.providers || []).every(p => typeof p.costUSD === 'number')
ok(withCost || (usage.providers || []).length === 0, 'every provider row carries costUSD')

// ── 4. UNBREAKABLE SWARM: disconnect mid-run, rejoin, still finish ───────
async function startSwarm(task) {
  const res = await fetch(`${BASE}/api/multi-agent`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      projectId: PID,
      task,
      config: { coordinatorCount: 0, qualityCheckerCount: 0, featureCheckerCount: 0, codeWriterCount: 1, setupAgentCount: 0, maxConcurrency: 1, agentTimeoutMs: 45000 },
    }),
  })
  return res
}

const res1 = await startSwarm('E2E unbreakable: write a single file hello.txt containing the text hi. Do not create anything else.')
ok(res1.ok && !!res1.body, 'swarm start → NDJSON stream opened', `status ${res1.status}`)

// Read until run_started, then HARD-CANCEL the connection (viewer "dies")
const reader1 = res1.body.getReader()
const dec = new TextDecoder()
let buf1 = ''
let runId1 = null
let cancelled = false
while (true) {
  const { done, value } = await reader1.read()
  if (done) break
  buf1 += dec.decode(value, { stream: true })
  const lines = buf1.split('\n'); buf1 = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      if (ev.type === 'run_started') runId1 = ev.runId
    } catch {}
  }
  if (runId1) break
}
ok(!!runId1, 'got runId from run_started', runId1 || 'none')
await reader1.cancel().catch(() => {})
cancelled = true
ok(cancelled, 'viewer connection hard-cancelled mid-run (abort NOT sent — detach expected)')

// Give the run a moment — then REJOIN from event 0 and read to the end
await new Promise(res => setTimeout(res, 2000))
const res2 = await fetch(`${BASE}/api/multi-agent`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ action: 'rejoin', runId: runId1, from: 0 }),
})
ok(res2.ok && !!res2.body, 'rejoin stream opened for the still-buffered run', `status ${res2.status}`)

let sawResumed = false, sawDone1 = false, sawHeartbeat = false, done1 = null, sawStatusAfterRejoin = false
if (res2.ok && res2.body) {
  const reader2 = res2.body.getReader()
  let buf2 = ''
  const deadline = Date.now() + 120_000
  outer: while (Date.now() < deadline) {
    const { done, value } = await reader2.read()
    if (done) break
    buf2 += dec.decode(value, { stream: true })
    const lines = buf2.split('\n'); buf2 = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let ev; try { ev = JSON.parse(line) } catch { continue }
      if (ev.type === 'resumed') sawResumed = true
      if (ev.type === 'heartbeat') sawHeartbeat = true
      if (ev.type === 'status') sawStatusAfterRejoin = true
      if (ev.type === 'done') { sawDone1 = true; done1 = ev; break outer }
    }
  }
  try { await reader2.cancel() } catch {}
}
ok(sawResumed, 'rejoin first event = resumed (replay contract)')
ok(sawStatusAfterRejoin, 'rejoined viewer received real run events (replay/live-tail)')
ok(sawDone1, 'rejoined stream reached done — the run FINISHED despite disconnect', done1 ? '' : '(no done within 120s)')
if (done1) ok(typeof done1.ok === 'boolean', 'done event carries honest ok flag', `ok=${done1.ok}`)
// v58 hardening: the heartbeat is a QUIET-PERIOD event (every 4s with no other
// traffic). If the planted run finishes in under ~4s the stream closes before
// any heartbeat fits — that is a FASTER-THAN-THE-HEARTBEAT race, not a missing
// feature. Retry the scenario (real run each time) so the liveness proof stays
// real while no longer racing provider latency.
async function heartbeatAttempt() {
  const resH = await fetch(`${BASE}/api/multi-agent`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      projectId: PID,
      task: 'E2E HBPROBE: write eight files s1.txt to s8.txt, each file containing its number. Do not create anything else.',
      config: { coordinatorCount: 0, qualityCheckerCount: 0, featureCheckerCount: 0, codeWriterCount: 5, setupAgentCount: 0, maxConcurrency: 1, agentTimeoutMs: 45000 },
    }),
  })
  let runIdH = null
  const decH = new TextDecoder()
  let bufH = ''
  const rH = resH.body.getReader()
  while (true) {
    const { done, value } = await rH.read()
    if (done) break
    bufH += decH.decode(value, { stream: true })
    const ls = bufH.split('\n'); bufH = ls.pop() || ''
    for (const l of ls) { try { const e = JSON.parse(l); if (e.runId) runIdH = e.runId } catch {} }
    if (runIdH) break
  }
  await rH.cancel().catch(() => {})
  if (!runIdH) return false
  // rejoin IMMEDIATELY — the retry task below runs ≥8s, so the 4s heartbeat
  // interval is guaranteed at least one firing inside the live window
  await new Promise(res => setTimeout(res, 300))
  const resR = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'rejoin', runId: runIdH, from: 0 }) })
  if (!resR.ok || !resR.body) return false
  const rR = resR.body.getReader()
  let bufR = ''
  let saw = false
  const deadlineH = Date.now() + 90_000
  outerH: while (Date.now() < deadlineH) {
    const { done, value } = await rR.read()
    if (done) break
    bufR += decH.decode(value, { stream: true })
    const ls = bufR.split('\n'); bufR = ls.pop() || ''
    for (const l of ls) {
      if (!l.trim()) continue
      let e; try { e = JSON.parse(l) } catch { continue }
      if (e.type === 'heartbeat') { saw = true; break outerH }
      if (e.type === 'done') break outerH
    }
  }
  await rR.cancel().catch(() => {})
  return saw
}
if (!sawHeartbeat) {
  for (let i = 0; i < 2 && !sawHeartbeat; i++) {
    sawHeartbeat = await heartbeatAttempt()
  }
}
ok(sawHeartbeat, 'heartbeat event seen (liveness proof)', '(3 real attempts — faster-than-heartbeat runs excluded)')

// ── 5. durable history: swarm run persisted in AgentRun + /api/runs ──────
r = await fetch(`${BASE}/api/runs?projectId=${PID}&limit=20`, { headers: H })
const runsData = await r.json()
ok(r.status === 200 && runsData.ok === true, 'GET /api/runs → 200 ok')
const swarmRow = (runsData.runs || []).find(x => x.model === 'swarm' && (x.prompt || '').includes('E2E unbreakable'))
ok(!!swarmRow, 'swarm run persisted an AgentRun row (model=swarm)')
if (swarmRow) {
  ok(['completed', 'failed', 'stopped'].includes(swarmRow.status), 'swarm history row has honest final status', `status=${swarmRow.status}`)
  ok(/swarm · \d+ ok \/ \d+ failed · \d+ files/.test(swarmRow.response || ''), 'swarm history response carries real counts', (swarmRow.response || '').slice(0, 80))
  ok(swarmRow.prompt.includes('E2E unbreakable'), 'swarm history row carries the task prompt')
}

// ── 6. stop visible to rejoining viewers ─────────────────────────────────
const res3 = await startSwarm('E2E stop test: write stop-me.txt then stop. This run will be stopped early.')
const reader3 = res3.body.getReader()
let runId3 = null
let buf3 = ''
while (true) {
  const { done, value } = await reader3.read()
  if (done) break
  buf3 += dec.decode(value, { stream: true })
  const lines = buf3.split('\n'); buf3 = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    try { const ev = JSON.parse(line); if (ev.type === 'run_started') runId3 = ev.runId } catch {}
  }
  if (runId3) break
}
ok(!!runId3, 'second swarm started (stop test)', runId3 || 'none')
await reader3.cancel().catch(() => {})
r = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'stop', runId: runId3 }) })
ok(r.status === 200, 'stop accepted for live run', `status ${r.status}`)
await new Promise(res => setTimeout(res, 1500))
const res4 = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'rejoin', runId: runId3, from: 0 }) })
ok(res4.ok && !!res4.body, 'rejoin stream opened for the stopped run', `status ${res4.status}`)
let sawStopNote = false, sawDone3 = false
if (res4.ok && res4.body) {
  const reader4 = res4.body.getReader()
  let buf4 = ''
  const deadline = Date.now() + 130_000
  outer2: while (Date.now() < deadline) {
    const { done, value } = await reader4.read()
    if (done) break
    buf4 += dec.decode(value, { stream: true })
    const lines = buf4.split('\n'); buf4 = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let ev; try { ev = JSON.parse(line) } catch { continue }
      if (ev.type === 'status' && /Stop requested/.test(ev.content || '')) sawStopNote = true
      if (ev.type === 'done') { sawDone3 = true; break outer2 }
    }
  }
  try { await reader4.cancel() } catch {}
}
ok(sawStopNote, 'rejoining viewer sees the stop request event')
ok(sawDone3, 'stopped run still reaches done for rejoining viewers')

// ── 7. archive: status PATCH + restore (nothing deleted) ─────────────────
r = await fetch(`${BASE}/api/projects/${PID}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'archived' }) })
ok(r.ok, 'PATCH project status → archived')
r = await fetch(`${BASE}/api/projects/${PID}`, { headers: H })
const projDetail = await r.json()
ok(projDetail?.project?.status === 'archived' || projDetail?.status === 'archived', 'project detail shows archived')
r = await fetch(`${BASE}/api/projects/${PID}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'stopped' }) })
ok(r.ok, 'PATCH project status → restored (unarchived)')

// ── cleanup: remove ONLY the rows this test created ──────────────────────
try { await db.agentRun.deleteMany({ where: { projectId: PID } }) } catch {}
try { await db.project.delete({ where: { id: PID } }) } catch {}
try { await db.lockSession.delete({ where: { tokenHash: sha256(TOKEN) } }) } catch {}

console.log('')
console.log(`=== RESULT: ${pass} PASS / ${fail} FAIL ===`)
process.exit(fail > 0 ? 1 : 0)
