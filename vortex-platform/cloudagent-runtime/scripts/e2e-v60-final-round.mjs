#!/usr/bin/env node
/**
 * v60 — "Aro" final-round E2E (non-destructive)
 *
 * Proves:
 *  1. 💰 Monthly budget guard — a cap of $0 blocks BOTH run entry points
 *     (/api/agent + /api/multi-agent) with an honest 402 BEFORE any model
 *     call (zero AgentRun rows, zero tokens); '' clears the cap; garbage
 *     values are rejected.
 *  2. 📣 Run-finished webhook — a real single-agent run POSTs one JSON
 *     summary to a local receiver started by THIS script, signed with
 *     X-CA-Signature (HMAC-SHA256 of the raw body + the configured secret);
 *     the payload carries run metadata only (no keys, no file contents).
 *  3. ⏪ Version history — snapshot → list → delete on a throwaway project
 *     through the real /api/versions endpoints.
 *
 * Non-destructive contract:
 *  - throwaway project (and its snapshot rows) removed via the REAL APIs
 *  - budget + webhook settings cleared at the end
 *  - lock token minted from the stored lock_secret (never rotated)
 */
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import http from 'http'
import fs from 'fs'

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

const RUN_STAMP = `__e2e v60 ${Date.now().toString(36)}`

// ── pre-state ────────────────────────────────────────────────────────────
const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
await db.lockSession.upsert({
  where: { tokenHash: sha256(TOKEN) },
  update: {},
  create: { tokenHash: sha256(TOKEN), device: 'E2E v60 final round', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

// v67 CRASH-SAFETY: remember the owner's pre-suite budget so ANY crash path
// can ALWAYS restore it — a mid-suite crash used to leave the cap at '0',
// which 402-blocked every later run (owner-visible outage, reproduced live).
const preBudgetRow = await db.userSetting.findUnique({ where: { key: 'budget_monthly_usd' } })
const preBudgetValue = preBudgetRow?.value ?? ''
let budgetRestored = false
async function restoreBudget() {
  if (budgetRestored) return
  budgetRestored = true
  try {
    await db.userSetting.upsert({
      where: { key: 'budget_monthly_usd' },
      update: { value: preBudgetValue },
      create: { key: 'budget_monthly_usd', value: preBudgetValue },
    })
  } catch {}
}
// Prisma is async-only, so an uncaughtException handler cannot await it.
// execSync + a pre-baked restore script is fully synchronous and survives
// ANY crash path (uncaughtException, unhandledRejection included).
const { execSync } = await import('child_process')
const restoreScript = [
  "const { PrismaClient } = require('@prisma/client')",
  'const db = new PrismaClient()',
  `db.userSetting.upsert({ where: { key: 'budget_monthly_usd' }, update: { value: ${JSON.stringify(preBudgetValue)} }, create: { key: 'budget_monthly_usd', value: ${JSON.stringify(preBudgetValue)} } }).finally(() => db.$disconnect())`,
].join('\n')
fs.writeFileSync('.e2e-v60-budget-restore.cjs', restoreScript)
function syncRestore() {
  try { execSync('node .e2e-v60-budget-restore.cjs', { cwd: process.cwd(), timeout: 20000, stdio: 'ignore' }) } catch {}
}
process.on('uncaughtException', (e) => { console.error('v60 CRASH (restoring budget):', e?.message || e); syncRestore(); process.exit(1) })
process.on('unhandledRejection', (e) => { console.error('v60 REJECTION (restoring budget):', String(e).slice(0, 200)); syncRestore(); process.exit(1) })

// v67 SELF-SUFFICIENCY: findFirst() returns null on a fresh/rolled-back DB
// (zero projects) and the suite crashed there mid-budget-window. Now the
// suite provisions its OWN host project when the DB has none — runs only
// need SOME projectId; cleanup hard-deletes it at the end.
let hostProject = await db.project.findFirst({ select: { id: true, name: true } })
let hostIsOurs = false
if (!hostProject) {
  const cr = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: `__e2e v60 host ${RUN_STAMP}` }) })
  const cj = await cr.json().catch(() => ({}))
  hostProject = cj.project || cj || null
  hostIsOurs = Boolean(hostProject?.id)
}
ok(Boolean(hostProject?.id), 'host project exists for run payloads')

console.log('— v60 Final-Round E2E —')

// ══ 1. 💰 Budget guard ═══════════════════════════════════════════════════
console.log('\n[1] Monthly budget guard')

let r = await fetch(`${BASE}/api/usage/budget`)
ok(r.status === 401, 'GET /api/usage/budget without token → 401')

r = await fetch(`${BASE}/api/usage/budget`, { headers: H })
ok(r.status === 200, 'GET budget with token → 200')
let j = await r.json()
ok(j.ok === true && typeof j.monthStart === 'string' && /^\d{4}-\d{2}-01$/.test(j.monthStart), `monthStart is a real month boundary (${j.monthStart})`)

// garbage is rejected
r = await fetch(`${BASE}/api/usage/budget`, { method: 'POST', headers: H, body: JSON.stringify({ value: 'lots of money' }) })
ok(r.status === 400, 'POST budget value="lots of money" → 400')

// set the cap to $0 → everything blocked
r = await fetch(`${BASE}/api/usage/budget`, { method: 'POST', headers: H, body: JSON.stringify({ value: '0' }) })
j = await r.json()
ok(j.ok === true && j.enabled === true && j.budgetUSD === 0, 'POST budget value="0" → cap active at $0')

const runsBefore = await db.agentRun.count({ where: { prompt: { contains: RUN_STAMP } } })

r = await fetch(`${BASE}/api/agent`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: hostProject.id, prompt: `${RUN_STAMP} single blocked`, forceBuiltIn: true }) })
j = await r.json().catch(() => ({}))
ok(r.status === 402, 'single run under $0 cap → 402 (blocked before any model call)', `got ${r.status}`)
ok(typeof j.error === 'string' && /budget/i.test(j.error), 'block message mentions the budget honestly')

r = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: hostProject.id, task: `${RUN_STAMP} swarm blocked` }) })
ok(r.status === 402, 'swarm run under $0 cap → 402')

const runsAfterBlock = await db.agentRun.count({ where: { prompt: { contains: RUN_STAMP } } })
ok(runsAfterBlock === runsBefore, 'blocked runs created ZERO AgentRun rows (no tokens burned)', `${runsBefore} → ${runsAfterBlock}`)

// clear the cap
r = await fetch(`${BASE}/api/usage/budget`, { method: 'POST', headers: H, body: JSON.stringify({ value: '' }) })
j = await r.json()
ok(j.ok === true && j.enabled === false, 'POST budget value="" → cap cleared (enabled false)')

// ══ 2. 📣 Run-finished webhook ═══════════════════════════════════════════
console.log('\n[2] Run-finished webhook')

const WH_PORT = 47_821
const WH_SECRET = 'e2e-v60-webhook-secret'
const hits = [] // { headers, rawBody }
const receiver = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    hits.push({ headers: req.headers, rawBody: body })
    res.writeHead(200).end('ok')
  })
})
await new Promise(resolve => receiver.listen(WH_PORT, '127.0.0.1', resolve))

r = await fetch(`${BASE}/api/usage/webhook`)
ok(r.status === 401, 'GET /api/usage/webhook without token → 401')

r = await fetch(`${BASE}/api/usage/webhook`, { method: 'POST', headers: H, body: JSON.stringify({ url: 'notaurl' }) })
ok(r.status === 400, 'POST webhook url="notaurl" → 400')

r = await fetch(`${BASE}/api/usage/webhook`, { method: 'POST', headers: H, body: JSON.stringify({ url: `http://127.0.0.1:${WH_PORT}/hook`, secret: WH_SECRET }) })
j = await r.json()
ok(j.ok === true && j.hasSecret === true, 'webhook url + secret saved')

r = await fetch(`${BASE}/api/usage/webhook`, { headers: H })
j = await r.json()
ok(j.ok === true && j.url.endsWith('/hook') && j.hasSecret === true, 'GET returns the url but never the secret itself')

// REAL single-agent run (built-in provider — no external key needed)
const runPrompt = `${RUN_STAMP} Reply with exactly: OK`
r = await fetch(`${BASE}/api/agent`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: hostProject.id, prompt: runPrompt, forceBuiltIn: true }) })
ok(r.status === 200 && (r.headers.get('content-type') || '').includes('ndjson'), 'real single-agent run started (NDJSON stream)')

// read the stream until done
const reader = r.body.getReader()
const dec = new TextDecoder()
let buf = '', sawDone = false, sseRunId = null
const runDeadline = Date.now() + 120_000
while (!sawDone && Date.now() < runDeadline) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const lines = buf.split('\n')
  buf = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type === 'run_started') sseRunId = ev.runId
    if (ev.type === 'done') sawDone = true
  }
}
ok(sawDone, 'single run finished (done event received)')
ok(Boolean(sseRunId), `run id captured (${sseRunId})`)

// wait for the webhook hit
let hit = null
const hitDeadline = Date.now() + 20_000
while (!hit && Date.now() < hitDeadline) {
  hit = hits.find(h => { try { return JSON.parse(h.rawBody).prompt?.includes(RUN_STAMP) } catch { return false } }) || null
  if (!hit) await new Promise(res => setTimeout(res, 500))
}
ok(Boolean(hit), 'webhook receiver got exactly our run summary POST')

if (hit) {
  let payload = null
  try { payload = JSON.parse(hit.rawBody) } catch {}
  ok(payload?.event === 'run.finished', "payload event === 'run.finished'")
  ok(payload?.kind === 'single' && payload?.runId === sseRunId, 'payload correlates kind=single + the real run id')
  ok(payload?.status === 'completed' && payload?.ok === true, 'payload status completed/ok (honest outcome)')
  const expectedSig = 'sha256=' + crypto.createHmac('sha256', WH_SECRET).update(hit.rawBody).digest('hex')
  ok(hit.headers['x-ca-signature'] === expectedSig, 'X-CA-Signature = HMAC-SHA256(raw body, secret) — verifiable by the receiver')
  ok(!/sk-|apiKey|apiKeyEnc|tokenEnc/i.test(hit.rawBody), 'payload carries NO keys or secrets')
} else {
  ok(false, 'payload checks skipped (no hit)')
}

// clear the webhook
r = await fetch(`${BASE}/api/usage/webhook`, { method: 'POST', headers: H, body: JSON.stringify({ url: '', secret: '' }) })
j = await r.json()
ok(j.ok === true && j.hasSecret === false && j.url === '', 'webhook settings cleared')
receiver.close()

// ══ 3. ⏪ Version history ════════════════════════════════════════════════
console.log('\n[3] Version history (throwaway project)')

r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: `${RUN_STAMP} versions`, description: 'throwaway', language: 'html' }) })
j = await r.json()
const vProjectId = j.project?.id
ok(Boolean(vProjectId), 'throwaway project created via real API')

r = await fetch(`${BASE}/api/versions`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: vProjectId, action: 'snapshot', label: 'e2e v60 snapshot' }) })
j = await r.json()
ok(j.ok === true && Boolean(j.snapshot?.id), 'snapshot created')
const snapFileCount = j.snapshot?.fileCount ?? -1
ok(snapFileCount >= 1, `snapshot captured real files (${snapFileCount})`)

r = await fetch(`${BASE}/api/versions?projectId=${vProjectId}`, { headers: H })
j = await r.json()
const listed = (j.versions || []).find(v => v.label === 'e2e v60 snapshot')
ok(Boolean(listed), 'snapshot appears in the list')

r = await fetch(`${BASE}/api/versions`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: vProjectId, action: 'delete', id: listed.id }) })
j = await r.json()
ok(j.ok === true, 'snapshot deleted')

r = await fetch(`${BASE}/api/versions?projectId=${vProjectId}`, { headers: H })
j = await r.json()
ok(!(j.versions || []).some(v => v.id === listed.id), 'deleted snapshot gone from the list')

// ── cleanup (real APIs only) ─────────────────────────────────────────────
// v62: platform DELETE is now a TRASH move — ?hard=1 keeps the cleanup
// truly permanent (no trashed residue after the suite).
r = await fetch(`${BASE}/api/projects/${vProjectId}?hard=1`, { method: 'DELETE', headers: H })
ok(r.status === 200 || r.status === 204, 'throwaway project deleted via real API')

// v67: hard-delete the self-provisioned host too (never touch a pre-existing one)
if (hostIsOurs && hostProject?.id) {
  await fetch(`${BASE}/api/projects/${hostProject.id}?hard=1`, { method: 'DELETE', headers: H }).catch(() => {})
  ok(!(await db.project.findFirst({ where: { id: hostProject.id } })), 'self-provisioned host project removed')
}

await restoreBudget()
const residualBudget = await db.userSetting.findUnique({ where: { key: 'budget_monthly_usd' } })
const residualWebhook = await db.userSetting.findUnique({ where: { key: 'notify_webhook_url' } })
ok((residualBudget?.value || '') === '' && (residualWebhook?.value || '') === '', 'budget + webhook settings left clean')

console.log(`\n════════════════════════════════`)
console.log(`v60 FINAL ROUND: ${pass} PASS / ${fail} FAIL`)
console.log(`════════════════════════════════`)
await restoreBudget() // even on FAIL, never leave a $0 cap behind
process.exit(fail === 0 ? 0 : 1)
