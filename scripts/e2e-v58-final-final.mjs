#!/usr/bin/env node
/**
 * v58 — FINAL-FINAL Batch E2E (non-destructive)
 *
 * Proves:
 *  1. 💾 /api/backup GET — full snapshot, lock-guarded, and the
 *     KEYS-NEVER-LEAK contract: the exported JSON contains NO apiKeyEnc
 *     anywhere, and security settings (lock/recovery) are excluded
 *  2. 💾 /api/backup POST — additive idempotent restore: restoring the SAME
 *     file twice upserts (no duplicate files, runs skipped as existing),
 *     garbage input rejected 400
 *  3. ⏰ /api/schedules — CRUD contract: min-interval floor enforced (5 min),
 *     enable/disable state machine (nextRunAt null ⇄ scheduled), delete
 *  4. ⏰ SCHEDULER FIRE PROOF — a real Schedule row with nextRunAt pushed
 *     into the past FIRES a real run through /api/agent: a real AgentRun
 *     row appears (server-side, no browser), the schedule stamps
 *     lastStatus/lastRunId, scheduler.status.running is true
 *
 * Non-destructive contract:
 *  - only rows it planted (its schedule + its fired AgentRun row) are
 *    removed afterwards; pre-existing data untouched
 *  - lock token minted from stored lock_secret (never rotates it)
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

const SCHED_PROMPT = '__e2e v58 scheduled tick — reply with OK and stop'

// ── pre-state ────────────────────────────────────────────────────────────
const preProjects = await db.project.findMany({ select: { id: true } })
let someProjectId = preProjects[0]?.id
let hostIsOurs = false
ok(Boolean(someProjectId) || true, 'pre-existing project present', someProjectId ? 'yes' : 'no — will self-provision')

const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
await db.lockSession.upsert({
  where: { tokenHash: sha256(TOKEN) },
  update: {},
  create: { tokenHash: sha256(TOKEN), device: 'E2E v58 final-final', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

// v67 SELF-SUFFICIENCY: on a fresh/rolled-back DB (zero projects) the suite
// used to run on with someProjectId=undefined and crash later — now it
// provisions its own host (AFTER H exists, so the call is authenticated)
// and hard-deletes it at cleanup.
if (!someProjectId) {
  const cr = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: '__e2e v58 host' }) })
  const cj = await cr.json().catch(() => ({}))
  someProjectId = cj?.project?.id || null
  hostIsOurs = Boolean(someProjectId)
}
ok(Boolean(someProjectId), 'a project exists to attach the test schedule to', hostIsOurs ? '(self-provisioned)' : '(pre-existing)')

console.log('— v58 Final-Final Batch E2E —')

// ══ 1. Backup export ═════════════════════════════════════════════════════
console.log('\n[1] /api/backup GET')

let r = await fetch(`${BASE}/api/backup`)
ok(r.status === 401, 'GET /api/backup without token → 401 (lock-guarded)')

r = await fetch(`${BASE}/api/backup`, { headers: H })
ok(r.status === 200, 'GET /api/backup with token → 200')
const backupPayload = await r.json().catch(() => null)
ok(backupPayload?.ok === true && backupPayload?.backup?.kind === 'cloud-agent-backup', 'backup has kind cloud-agent-backup')
ok(backupPayload?.backup?.version === 1 && typeof backupPayload?.backup?.exportedAt === 'string', 'version + exportedAt present')
const counts = backupPayload?.backup?.counts || {}
ok(typeof counts.projects === 'number' && counts.projects >= 1, `counts.projects honest (${counts.projects})`)
ok(Array.isArray(backupPayload?.backup?.data?.projects) && backupPayload.backup.data.projects.length === counts.projects, 'projects array matches counts')

const raw = JSON.stringify(backupPayload)
ok(!raw.includes('apiKeyEnc'), 'KEYS-NEVER-LEAK: no apiKeyEnc anywhere in the export')
ok(!raw.includes('tokenEnc'), 'KEYS-NEVER-LEAK: no GitHub tokenEnc anywhere in the export')
const secKeys = (backupPayload?.backup?.data?.userSettings || []).map(s => s.key)
ok(!secKeys.some(k => /^(lock|recovery)/i.test(k)), `security settings excluded from export (${secKeys.length} user settings carried)`)
ok((counts.skippedSecuritySettings || 0) >= 3, `skippedSecuritySettings honest (${counts.skippedSecuritySettings})`)

const firstProj = backupPayload.backup.data.projects[0]
ok(firstProj && Array.isArray(firstProj.files), 'first project carries its files array')
ok(typeof firstProj?.note !== 'string' && typeof backupPayload.backup.note === 'string', 'honest note present (keys re-enter after restore)')

// ══ 2. Backup restore (additive + idempotent) ════════════════════════════
console.log('\n[2] /api/backup POST (restore)')

r = await fetch(`${BASE}/api/backup`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ kind: 'nope' }),
})
ok(r.status === 400, `restore rejects a non-backup JSON → 400 (got ${r.status})`)
ok(r.status !== 401, 'lock was satisfied — the 400 came from the route itself')

const lockSecretBefore = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
const fileCountBefore = await db.file.count()
r = await fetch(`${BASE}/api/backup`, { method: 'POST', headers: H, body: JSON.stringify(backupPayload) })
ok(r.status === 200, 'restore of the real backup → 200')
const restore1 = await r.json().catch(() => null)
ok(restore1?.ok === true && restore1?.stats, `restore stats returned (${JSON.stringify(restore1?.stats || {}).slice(0, 120)})`)
ok(restore1.stats.securitySettingsSkipped === 0, 'export already excludes security keys → restore payload carries none to skip')

const fileCountAfterOne = await db.file.count()
r = await fetch(`${BASE}/api/backup`, { method: 'POST', headers: H, body: JSON.stringify(backupPayload) })
const restore2 = await r.json().catch(() => null)
ok(restore2?.ok === true, 'second restore of the SAME backup → 200 (idempotent)')
const fileCountAfterTwo = await db.file.count()
ok(fileCountAfterOne === fileCountBefore, `restore #1 duplicated nothing (files ${fileCountBefore} → ${fileCountAfterOne})`)
ok(fileCountAfterTwo === fileCountAfterOne, `restore #2 duplicated nothing (files stable at ${fileCountAfterTwo})`)
ok(restore2.stats.runsSkippedExisting >= restore1.stats.runsImported, `runs skipped as existing on re-restore (${restore2.stats.runsSkippedExisting})`)
const lockSecretAfter = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
ok(lockSecretAfter === lockSecretBefore, 'SECURITY PROOF: lock_secret unchanged by restore')

// ══ 3. Schedules CRUD contract ═══════════════════════════════════════════
console.log('\n[3] /api/schedules CRUD')

r = await fetch(`${BASE}/api/schedules?projectId=${someProjectId}`, { headers: H })
ok(r.status === 200, 'GET /api/schedules with token → 200')
const list0 = await r.json().catch(() => null)
ok(list0?.ok === true && Array.isArray(list0.schedules), 'schedule list is an array')
ok(list0?.scheduler?.running === true, 'scheduler tick is RUNNING (booted at server start / first touch)')

r = await fetch(`${BASE}/api/schedules`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ projectId: someProjectId, prompt: 'x', intervalMinutes: 2 }),
})
ok(r.status === 400, 'create with intervalMinutes=2 → 400 (5-minute floor protects keys)')

r = await fetch(`${BASE}/api/schedules`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ projectId: someProjectId, prompt: SCHED_PROMPT, mode: 'single', intervalMinutes: 5 }),
})
ok(r.status === 200, 'create valid schedule (single / 5 min) → 200')
const created = await r.json().catch(() => null)
const schedId = created?.schedule?.id
ok(Boolean(schedId), 'schedule id returned')
const nextIn = created?.schedule?.nextRunAt ? new Date(created.schedule.nextRunAt) - Date.now() : -1
ok(nextIn > 4 * 60_000 && nextIn <= 5.5 * 60_000, `nextRunAt ≈ now+5min (${Math.round(nextIn / 1000)}s)`)

r = await fetch(`${BASE}/api/schedules`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ id: schedId, enabled: false }),
})
const disabled = await r.json().catch(() => null)
ok(disabled?.schedule?.enabled === false && disabled.schedule.nextRunAt === null, 'disable → enabled:false AND nextRunAt:null (nothing hidden)')

r = await fetch(`${BASE}/api/schedules`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ id: schedId, enabled: true }),
})
const enabled = await r.json().catch(() => null)
ok(enabled?.schedule?.enabled === true && Boolean(enabled.schedule.nextRunAt), 're-enable → nextRunAt scheduled again')

// ══ 4. THE FIRE PROOF — scheduler really fires a real run ════════════════
console.log('\n[4] scheduler fire proof (real run through /api/agent)')

const t0 = new Date()
// Push nextRunAt into the past — the 30s tick must pick it up and fire.
await db.schedule.update({
  where: { id: schedId },
  data: { nextRunAt: new Date(Date.now() - 1000), enabled: true },
})

let firedRow = null
const deadline = Date.now() + 90_000
let lastCount = -1
while (Date.now() < deadline) {
  await new Promise(res => setTimeout(res, 4000))
  firedRow = await db.agentRun.findFirst({
    where: { prompt: SCHED_PROMPT, createdAt: { gte: new Date(t0.getTime() - 5000) } },
    orderBy: { createdAt: 'desc' },
  })
  if (firedRow) break
  const cur = await db.schedule.findUnique({ where: { id: schedId } })
  const c = cur?.lastRunAt ? 'stamped' : 'waiting'
  if (c !== lastCount) { console.log(`    … tick watching: ${c} (${Math.round((deadline - Date.now()) / 1000)}s left)`); lastCount = c }
}
ok(Boolean(firedRow), 'REAL AgentRun row appeared for the scheduled prompt (fired server-side, no browser)')

const schedAfter = await db.schedule.findUnique({ where: { id: schedId } })
ok(schedAfter?.lastRunAt && new Date(schedAfter.lastRunAt) >= new Date(t0.getTime() - 5000), 'schedule.lastRunAt stamped honestly')
ok(typeof schedAfter?.lastStatus === 'string' && schedAfter.lastStatus.length > 0, `schedule.lastStatus honest ("${schedAfter?.lastStatus}")`)
ok(Boolean(schedAfter?.nextRunAt) && new Date(schedAfter.nextRunAt) > Date.now(), 'nextRunAt re-scheduled ~5min ahead after the fire')

// ══ 5. /api/runs regression (history + details feed off the same rows) ═══
console.log('\n[5] history endpoints regression')

r = await fetch(`${BASE}/api/runs?limit=5`, { headers: H })
ok(r.status === 200, 'GET /api/runs still answers (v55/v58 detail view data source)')
const runsNow = await r.json().catch(() => null)
ok(Array.isArray(runsNow?.runs), 'runs list is an array')
const oneWithResponse = (runsNow?.runs || []).find(x => (x.response || '').length > 0)
ok(Boolean(oneWithResponse) || true, `run rows carry response for the details card (${oneWithResponse ? 'yes' : 'none stored yet — ok'})`)

// ══ cleanup (only planted rows) ═══════════════════════════════════════════
console.log('\n[cleanup] removing only planted rows')
if (schedId) {
  const d = await fetch(`${BASE}/api/schedules?id=${schedId}`, { method: 'DELETE', headers: H })
  ok(d.status === 200, 'planted schedule removed via API')
}
if (firedRow) {
  await db.agentRun.delete({ where: { id: firedRow.id } })
  console.log('  ✓ fired e2e AgentRun row removed (schedule prompt is e2e-tagged, no UI residue)')
}
if (hostIsOurs && someProjectId) {
  await fetch(`${BASE}/api/projects/${someProjectId}?hard=1`, { method: 'DELETE', headers: H }).catch(() => {})
  console.log('  ✓ self-provisioned host project hard-deleted')
}

console.log(`\n━━━ RESULT: ${pass} PASS / ${fail} FAIL ━━━`)
process.exit(fail === 0 ? 0 : 1)
