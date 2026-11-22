#!/usr/bin/env node
/**
 * v57 — Live Agent Board + Never-give-up Rejoin + Cursor Fix E2E (non-destructive)
 *
 * Proves:
 *  1. GET /api/providers/health carries per-key balancer status (the pool
 *     view that answers "kon AI kaj korse, kon korsena" BEFORE any run)
 *  2. A REAL swarm run emits the full agent-identity event stream the
 *     Agent Board is built from: agent_start {agentId, role, task} …
 *     agent_result {ok, provider, model, durationMs}
 *  3. THE CURSOR FIX: rejoining heartbeats are stamped streamOnly:true and
 *     'resumed' is replay-only — a client that counts every other event
 *     ends with cursor === buffered events length, so the NEXT rejoin
 *     replays NOTHING it already saw and MISSES NOTHING. (Before v57 the
 *     cursor drifted +1/+N per reconnect and real events got skipped.)
 *  4. A second rejoin from the final cursor of a finished run replays zero
 *     events (from === total) — gap-free by construction.
 *
 * Non-destructive contract:
 *  - lock token minted from stored lock_secret (never rotates it)
 *  - the test project + its AgentRun rows are deleted at the end
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
  create: { tokenHash: sha256(TOKEN), device: 'E2E v57 agent board', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

console.log('— v57 Agent Board + Rejoin Cursor E2E —')

// ── 1. pool health contract (kon AI healthy / cooldown / dead) ───────────
let r = await fetch(`${BASE}/api/providers/health`, { headers: H })
const health = await r.json()
ok(r.status === 200, 'GET /api/providers/health → 200', `got ${r.status}`)
ok(Array.isArray(health.providers), 'health.providers list present (Key Health chips data)')
ok((health.providers || []).every(p => typeof p.status === 'string' && typeof p.role === 'string'),
  'every pool key carries status + role (board chips contract)', JSON.stringify(health.providers || []).slice(0, 120))

// ── 2. test project + REAL swarm run ─────────────────────────────────────
r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '__e2e_v57_agent_board' }) })
const proj = (await r.json()).project
ok(!!proj?.id, 'test project created', JSON.stringify(proj).slice(0, 100))
const PID = proj.id

const res1 = await fetch(`${BASE}/api/multi-agent`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    projectId: PID,
    task: 'E2E v57: write a single file board.txt containing the text ok. Do not create anything else.',
    config: { coordinatorCount: 0, qualityCheckerCount: 0, featureCheckerCount: 0, codeWriterCount: 1, setupAgentCount: 0, maxConcurrency: 1, agentTimeoutMs: 45000 },
  }),
})
ok(res1.ok && !!res1.body, 'swarm start → NDJSON stream opened', `status ${res1.status}`)

const dec = new TextDecoder()
const reader1 = res1.body.getReader()
let buf1 = '', runId1 = null
while (true) {
  const { done, value } = await reader1.read()
  if (done) break
  buf1 += dec.decode(value, { stream: true })
  const lines = buf1.split('\n'); buf1 = lines.pop() || ''
  for (const line of lines) {
    try { const ev = JSON.parse(line); if (ev.type === 'run_started') runId1 = ev.runId } catch {}
  }
  if (runId1) break
}
ok(!!runId1, 'got runId from run_started', runId1 || 'none')
await reader1.cancel().catch(() => {}) // viewer "dies" (no abort — detach)

// ── 3. rejoin with v57 CURSOR MATH (skip resumed + streamOnly) ───────────
await new Promise(res => setTimeout(res, 2000))
const res2 = await fetch(`${BASE}/api/multi-agent`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ action: 'rejoin', runId: runId1, from: 0 }),
})
ok(res2.ok && !!res2.body, 'rejoin stream opened', `status ${res2.status}`)

let cursor = 0                      // what the v57 client would hold
let sawResumed = false, sawStreamOnly = false, sawDone = false
let sawAgentStart = null, sawAgentResult = null, sawAgentResultOk = null
const seenTypes = {}
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
      seenTypes[ev.type] = (seenTypes[ev.type] || 0) + 1
      // v57 client cursor rule: resumed + streamOnly heartbeats do NOT count
      if (ev.type !== 'resumed' && !ev.streamOnly) cursor++
      if (ev.type === 'resumed') sawResumed = true
      if (ev.streamOnly) sawStreamOnly = true
      if (ev.type === 'agent_start' && !sawAgentStart) sawAgentStart = ev
      if (ev.type === 'agent_result' && !sawAgentResult) sawAgentResult = ev
      if (ev.type === 'agent_result' && ev.ok && !sawAgentResultOk) sawAgentResultOk = ev
      if (ev.type === 'done') { sawDone = true; break outer }
    }
  }
  try { await reader2.cancel() } catch {}
}
ok(sawResumed, 'rejoin first event = resumed (replay contract)')
ok(sawDone, 'rejoined stream reached done — run finished despite disconnect')
// v58 hardening: streamOnly heartbeats only fire during a ≥4s quiet stretch.
// A run faster than that closes the stream before any heartbeat fits — a
// faster-than-the-heartbeat race, not a missing stamp. Retry the scenario
// (real run each time) so the stamp proof stays real while not racy.
async function streamOnlyAttempt() {
  const resH = await fetch(`${BASE}/api/multi-agent`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      projectId: PID,
      task: 'E2E HBPROBE v57: write eight files s1.txt to s8.txt, each file containing its number. Do not create anything else.',
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
    for (const l of ls) { try { const e = JSON.parse(l); if (e.type === 'run_started') runIdH = e.runId } catch {} }
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
      if (e.streamOnly && e.type === 'heartbeat') { saw = true; break outerH }
      if (e.type === 'done') break outerH
    }
  }
  await rR.cancel().catch(() => {})
  return saw
}
if (!sawStreamOnly) {
  for (let i = 0; i < 2 && !sawStreamOnly; i++) {
    sawStreamOnly = await streamOnlyAttempt()
  }
}
ok(sawStreamOnly, 'streamOnly heartbeat seen (v57 liveness stamp present)', '(3 real attempts — faster-than-heartbeat runs excluded)')

// Agent Board data contract
ok(!!sawAgentStart && typeof sawAgentStart.agentId === 'string' && typeof sawAgentStart.role === 'string',
  'agent_start carries agentId + role (board card source)', JSON.stringify(sawAgentStart || {}).slice(0, 120))
ok(!!sawAgentResult && typeof sawAgentResult.ok === 'boolean',
  'agent_result carries ok flag (board status source)', JSON.stringify(sawAgentResult || {}).slice(0, 120))
if (sawAgentResultOk) {
  ok(typeof sawAgentResultOk.provider === 'string' && typeof sawAgentResultOk.durationMs === 'number',
    'successful agent_result carries provider + durationMs (scoreboard source)', '')
}

// ── 4. THE CURSOR FIX PROOF: rejoin from final cursor of the DONE run ────
const res3 = await fetch(`${BASE}/api/multi-agent`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ action: 'rejoin', runId: runId1, from: cursor }),
})
ok(res3.ok, 'final rejoin from cursor → stream opened', `status ${res3.status}`)
let resumed3 = null, replayedCount = 0
if (res3.ok && res3.body) {
  const reader3 = res3.body.getReader()
  let buf3 = ''
  const deadline = Date.now() + 15_000
  outer3: while (Date.now() < deadline) {
    const { done, value } = await reader3.read()
    if (done) break
    buf3 += dec.decode(value, { stream: true })
    const lines = buf3.split('\n'); buf3 = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let ev; try { ev = JSON.parse(line) } catch { continue }
      if (ev.type === 'resumed') { resumed3 = ev; continue }
      if (ev.type === 'done' || ev.type === 'error') break outer3
      replayedCount++
    }
  }
  try { await reader3.cancel() } catch {}
}
ok(!!resumed3, 'final rejoin answered with resumed', '')
ok(resumed3 && Number(resumed3.from) === Number(resumed3.total),
  `cursor === buffer length — ZERO drift (from=${resumed3?.from}, total=${resumed3?.total})`,
  resumed3 ? `from=${resumed3.from} total=${resumed3.total}` : 'no resumed')
ok(replayedCount === 0, 'final rejoin replayed ZERO events (nothing missed, nothing duplicated)', `replayed ${replayedCount}`)

// ── 5. durable history regression (v55) ──────────────────────────────────
r = await fetch(`${BASE}/api/runs?projectId=${PID}&limit=10`, { headers: H })
const runsData = await r.json()
const swarmRow = (runsData.runs || []).find(x => x.model === 'swarm' && (x.prompt || '').includes('E2E v57:'))
ok(!!swarmRow && ['completed', 'failed', 'stopped'].includes(swarmRow.status),
  'swarm run persisted with honest final status (v55 regression)', swarmRow ? `status=${swarmRow.status}` : 'no row')

// ── 6. cleanup: test project + its AgentRun rows only ────────────────────
const before = await db.agentRun.findMany({ where: { projectId: PID } })
await db.agentRun.deleteMany({ where: { projectId: PID } }).catch(() => {})
await db.project.delete({ where: { id: PID } }).catch(() => {})
const afterProj = await db.project.findUnique({ where: { id: PID } })
ok(!afterProj, 'cleanup: test project removed (nothing else touched)', `agentRun rows removed: ${before.length}`)

console.log(`\n── v57 Agent Board + Cursor: ${pass} PASS / ${fail} FAIL ──`)
await db.$disconnect()
process.exit(fail === 0 ? 0 : 1)
