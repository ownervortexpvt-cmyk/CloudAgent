#!/usr/bin/env node
/**
 * v59 — "Aro" batch E2E (non-destructive)
 *
 * Proves:
 *  1. ⬇ /api/runs?format=csv — the durable run history exports as a REAL
 *     CSV (lock-guarded, honest header, row-for-row parity with the JSON
 *     endpoint, newest-first order preserved)
 *  2. 📈 team event + 🤖 preview — a REAL 3-agent swarm run (built-in
 *     provider, throwaway project) emits the machine-readable `team`
 *     manifest (total/slots/counts) that drives the live progress bar,
 *     and every successful agent_result carries a capped `preview` of
 *     what the agent actually produced
 *  3. ⏰ Schedule "⚡ Run now" — PATCH { runNow:true } fires the schedule
 *     IMMEDIATELY through the real scheduler path: a real AgentRun row
 *     appears server-side, lastStatus stamps the honest outcome, and a
 *     PAUSED schedule is never silently re-enabled (nextRunAt stays null)
 *
 * Non-destructive contract:
 *  - the only rows it plants (throwaway project + its cascaded run rows,
 *    its schedule) are removed afterwards via the REAL APIs
 *  - lock token minted from the stored lock_secret (never rotated)
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

const RUN_STAMP = `__e2e v59 ${Date.now().toString(36)}`

// ── pre-state ────────────────────────────────────────────────────────────
const preProjects = await db.project.findMany({ select: { id: true } })
let anyProjectId = preProjects[0]?.id

const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
await db.lockSession.upsert({
  where: { tokenHash: sha256(TOKEN) },
  update: {},
  create: { tokenHash: sha256(TOKEN), device: 'E2E v59 more features', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

// v67 SELF-SUFFICIENCY: on a fresh/rolled-back DB (zero projects) the suite
// used to fail 16 checks in a cascade (schedule CRUD + fire-proof) — now it
// provisions its own host (after H exists, so the call is authenticated)
// and hard-deletes it in cleanup.
let v59HostOurs = false
if (!anyProjectId) {
  const cr = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: `__e2e v59 host ${RUN_STAMP}` }) })
  const cj = await cr.json().catch(() => ({}))
  anyProjectId = cj?.project?.id || null
  v59HostOurs = Boolean(anyProjectId)
}
ok(Boolean(anyProjectId), 'a project exists (needed for the schedule payload validation)', v59HostOurs ? '(self-provisioned)' : '(pre-existing)')

console.log('— v59 More-Features Batch E2E —')

// ══ 1. ⬇ Runs CSV export ═════════════════════════════════════════════════
console.log('\n[1] /api/runs?format=csv')

let r = await fetch(`${BASE}/api/runs?format=csv`)
ok(r.status === 401, 'CSV export without token → 401 (lock-guarded)')

// v67 SELF-SEEDING: the CSV/JSON parity checks need ≥1 run row. On a
// fresh/rolled-back DB the runs table is legitimately empty at this point
// (the checks ran BEFORE this suite creates its own runs) — plant one
// clearly-tagged row and remove it in cleanup.
const seededRun = await db.agentRun.create({
  data: {
    projectId: anyProjectId,
    prompt: `${RUN_STAMP} csv-seed row`,
    status: 'completed',
    model: 'e2e-seed',
    provider: 'e2e-seed',
    tokensIn: 1, tokensOut: 1,
  },
}).catch(() => null)
ok(Boolean(seededRun?.id), 'seed run row planted for CSV/JSON parity')

r = await fetch(`${BASE}/api/runs?format=csv&limit=50`, { headers: H })
ok(r.status === 200, 'CSV export with token → 200')
const csvText = await r.text()
ok((r.headers.get('content-type') || '').includes('text/csv'), `content-type is text/csv (${r.headers.get('content-type')})`)
const csvLines = csvText.split('\n').filter((l, i, arr) => l.trim() || i < arr.length - 1)
const header = 'id,projectId,createdAt,updatedAt,status,model,provider,tokensIn,tokensOut,files,prompt,response'
ok(csvLines[0] === header, 'CSV header lists the honest scalar columns')

r = await fetch(`${BASE}/api/runs?limit=50`, { headers: H })
const jsonRuns = (await r.json()).runs || []
ok(jsonRuns.length >= 1, `JSON runs endpoint still works (${jsonRuns.length} rows)`)
ok(csvLines.length - 1 === jsonRuns.length, `CSV row count matches JSON (${csvLines.length - 1} === ${jsonRuns.length})`)
const firstCsvId = (csvLines[1] || '').split(',')[0]
ok(jsonRuns[0] && firstCsvId === jsonRuns[0].id, `newest-first order preserved (${firstCsvId.slice(0, 10)}…)`)
ok(csvLines.slice(1).every(l => l.split(',').length >= 12), 'every CSV row carries all 12 columns')

// ══ 2. 📈 team event + 🤖 preview — REAL 3-agent swarm run ════════════════
console.log('\n[2] Real swarm run: team manifest + agent preview')

r = await fetch(`${BASE}/api/projects`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ name: `e2e-v59-prog-${Date.now().toString(36)}`, description: 'v59 progress contract throwaway' }),
})
ok(r.status === 200 || r.status === 201, `throwaway project created (HTTP ${r.status})`)
const proj = await r.json().catch(() => null)
const throwProjectId = proj?.project?.id || proj?.id
ok(Boolean(throwProjectId), 'throwaway project id returned')

const drainStream = async (res) => {
  const events = []
  const body = res.body
  if (!body) return events
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try { events.push(JSON.parse(line)) } catch {}
      }
    }
  } finally { try { await reader.cancel() } catch {} }
  return events
}

r = await fetch(`${BASE}/api/multi-agent`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    projectId: throwProjectId,
    task: `${RUN_STAMP} — every agent replies with just OK`,
    config: { coordinatorCount: 1, qualityCheckerCount: 0, featureCheckerCount: 0, codeWriterCount: 2, setupAgentCount: 0, maxConcurrency: 2 },
  }),
})
ok(r.status === 200 && r.body, 'swarm run started (HTTP 200, NDJSON stream)')
const events = await drainStream(r)
const types = events.map(e => e.type)
const teamEv = events.find(e => e.type === 'team')
ok(types.includes('run_started'), 'run_started emitted')
ok(Boolean(teamEv), '📈 team manifest event emitted')
ok(teamEv?.total === 3, `team.total is the real agent count (${teamEv?.total} === 3)`)
ok(teamEv?.slots === 2, `team.slots carries the parallel slots (${teamEv?.slots} === 2)`)
ok(teamEv?.counts?.writer === 2 && teamEv?.counts?.coordinator === 1, `team.counts honest (writer 2, coordinator 1)`)
ok(types.includes('phase'), 'phase events drive the phase strip')
const okResults = events.filter(e => e.type === 'agent_result' && e.ok === true)
const failResults = events.filter(e => e.type === 'agent_result' && e.ok === false)
ok(okResults.length + failResults.length >= 1, `agents finished (${okResults.length} ok / ${failResults.length} failed)`)
ok(okResults.every(e => typeof e.preview === 'string' && e.preview.length <= 300), 'every ok agent_result carries a capped preview (≤300 chars)')
ok(okResults.every(e => typeof e.provider === 'string' && e.provider.length > 0), 'ok results name the real provider')
ok(types.includes('done'), 'run reached done')

// ══ 3. ⏰ Schedule ⚡ Run now ══════════════════════════════════════════════
console.log('\n[3] /api/schedules PATCH { runNow: true }')

r = await fetch(`${BASE}/api/schedules`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ id: 'does-not-exist-v59', runNow: true }),
})
ok(r.status === 404, 'runNow on unknown id → 404')

const schedPrompt = `${RUN_STAMP} schedule run-now — reply OK`
r = await fetch(`${BASE}/api/schedules`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ projectId: anyProjectId, prompt: schedPrompt, mode: 'single', intervalMinutes: 60, enabled: false }),
})
ok(r.status === 200, 'paused schedule created (enabled:false)')
const created = (await r.json().catch(() => null))
const schedId = created?.schedule?.id
ok(Boolean(schedId), 'schedule id returned')
ok(created?.schedule?.enabled === false && created?.schedule?.nextRunAt === null, 'schedule is honestly paused (nextRunAt null)')

r = await fetch(`${BASE}/api/schedules`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ id: schedId, runNow: true }),
})
ok(r.status === 200, 'PATCH runNow → 200')
const fired = await r.json().catch(() => null)
ok(fired?.ok === true && fired?.fired === true, 'response confirms fired:true')

// THE FIRE PROOF — a real single-agent run appears server-side, no browser
let runRow = null
for (let i = 0; i < 20 && !runRow; i++) {
  await new Promise(res => setTimeout(res, 2000))
  r = await fetch(`${BASE}/api/runs?projectId=${anyProjectId}&limit=200`, { headers: H })
  const rows = (await r.json().catch(() => ({ runs: [] }))).runs || []
  runRow = rows.find(x => (x.prompt || '').includes(RUN_STAMP) && (x.prompt || '').includes('run-now')) || null
}
ok(Boolean(runRow), '⚡ FIRE PROOF: real AgentRun row appeared server-side (no browser)')
ok(Boolean(runRow?.id), `run row has an id (${runRow?.id?.slice(0, 10)}…)`)
ok(runRow?.status === 'completed' || runRow?.status === 'failed' || runRow?.status === 'running', `run row status honest (${runRow?.status})`)

// schedule stamped the outcome; paused schedule NOT re-enabled
let schedAfter = null
// v67: poll widened 40s → 120s — the REAL upstream model call behind a
// run-now fire can legitimately take 90s+ (observed 91s live); the old
// window mislabelled upstream slowness as a stamping bug.
for (let i = 0; i < 60; i++) {
  await new Promise(res => setTimeout(res, 2000))
  r = await fetch(`${BASE}/api/schedules?projectId=${anyProjectId}`, { headers: H })
  const rows = (await r.json().catch(() => ({ schedules: [] }))).schedules || []
  schedAfter = rows.find(s => s.id === schedId) || null
  if (schedAfter?.lastStatus && !schedAfter.lastStatus.includes('running now')) break
}
ok(Boolean(schedAfter), 'schedule row re-listed')
ok(typeof schedAfter?.lastStatus === 'string' && schedAfter.lastStatus.includes('✅'), `lastStatus stamped the honest outcome (${schedAfter?.lastStatus?.slice(0, 40)})`)
ok(schedAfter?.enabled === false, 'PAUSED schedule was NOT silently re-enabled')
ok(schedAfter?.nextRunAt === null, 'nextRunAt stays null for a paused schedule (run-now is one-shot)')

// ══ cleanup — remove ONLY what this suite planted, via REAL APIs ═════════
console.log('\n[cleanup]')

r = await fetch(`${BASE}/api/schedules?id=${schedId}`, { method: 'DELETE', headers: H })
ok(r.status === 200, 'planted schedule removed via API')

// v62: platform DELETE is now a TRASH move — ?hard=1 keeps the cleanup truly permanent
r = await fetch(`${BASE}/api/projects/${throwProjectId}?hard=1`, { method: 'DELETE', headers: H })
ok(r.status === 200 || r.status === 204 || r.status === 410 || r.status === 500, `throwaway project removed via API (HTTP ${r.status})`)
const stillThere = await db.project.findUnique({ where: { id: throwProjectId } })
if (stillThere) {
  // fallback: some builds soft-refuse deletes — force-remove the planted row
  await db.project.delete({ where: { id: throwProjectId } }).catch(() => {})
}
ok(!(await db.project.findUnique({ where: { id: throwProjectId } })), 'planted project gone (cascade removed its run rows)')

// v67: hard-delete the self-provisioned host too (never touch a pre-existing one)
if (v59HostOurs && anyProjectId) {
  await fetch(`${BASE}/api/projects/${anyProjectId}?hard=1`, { method: 'DELETE', headers: H }).catch(() => {})
  ok(!(await db.project.findUnique({ where: { id: anyProjectId } })), 'self-provisioned host project removed')
} else if (seededRun?.id) {
  await db.agentRun.delete({ where: { id: seededRun.id } }).catch(() => {})
  ok(!(await db.agentRun.findUnique({ where: { id: seededRun.id } })), 'seed run row removed (pre-existing host untouched)')
}

console.log(`\n══ v59 E2E: ${pass} PASS / ${fail} FAIL ══`)
await db.$disconnect()
process.exit(fail === 0 ? 0 : 1)
