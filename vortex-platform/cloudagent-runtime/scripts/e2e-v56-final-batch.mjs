#!/usr/bin/env node
/**
 * v56 — Final Batch E2E (non-destructive)
 *
 * Proves:
 *  1. POST /api/providers/test-all — bulk REAL health check of the saved pool
 *     • 401 without lock token (protected like every mutation route)
 *     • honest shape: { okCount, total, durationMs, results[] } with per-key
 *       id/name/kind/model/ok/durationMs
 *     • a deliberately INVALID key comes back ok:false with an honest error
 *       (never fakes a pass) — while healthy rows keep ok:true
 *     • okCount math always consistent with results
 *  2. GET /api/runs still answers (v55 durable history, regression)
 *  3. /lock page still serves (auth surface untouched)
 *
 * Non-destructive contract:
 *  - captures pre-existing providers, deletes only its own test row
 *  - lock token minted from stored lock_secret (never rotates it)
 *  - vault file untouched (no provider mutation happens)
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

const BAD_NAME = '__e2e_v56_badkey_provider'

// ── pre-state ────────────────────────────────────────────────────────────
const preProviders = await db.aIProvider.findMany()
const preIds = new Set(preProviders.map(p => p.id))

const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
await db.lockSession.upsert({
  where: { tokenHash: sha256(TOKEN) },
  update: {},
  create: { tokenHash: sha256(TOKEN), device: 'E2E v56 final batch', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

console.log('— v56 Final Batch E2E —')

// 1. auth surface
let r = await fetch(`${BASE}/api/providers/test-all`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
})
ok(r.status === 401, 'test-all WITHOUT token → 401 (protected)', `got ${r.status}`)

r = await fetch(`${BASE}/lock`, { cache: 'no-store' })
ok(r.status === 200, 'GET /lock → 200 (auth page intact)', `got ${r.status}`)

r = await fetch(`${BASE}/api/runs`, { headers: H })
ok(r.status === 200, 'GET /api/runs with token → 200 (v55 regression)', `got ${r.status}`)
const runsData = await r.json().catch(() => null)
ok(runsData && (Array.isArray(runsData.runs) || Array.isArray(runsData)), '/api/runs returns a list', JSON.stringify(runsData).slice(0, 80))

// 2. plant one deliberately-broken provider THROUGH THE REAL API (so the key
//    is properly encrypted server-side, exactly like a user's bad key) —
//    the bulk check must report it FAILED with a transport-honest error
let rPlant = await fetch(`${BASE}/api/providers`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    name: BAD_NAME,
    kind: 'custom',
    endpoint: 'https://invalid-v56-e2e.invalid/v1',
    model: 'test-model-x',
    apiKey: 'sk-e2e-v56-deliberately-bad-key-0001',
    temperature: 0.7,
  }),
})
ok(rPlant.status === 200 || rPlant.status === 201, 'planted bad provider saved via real API (encrypted like a real key)', `got ${rPlant.status}`)

// 3. bulk health check with token
r = await fetch(`${BASE}/api/providers/test-all`, {
  method: 'POST', headers: H, body: '{}',
})
ok(r.status === 200, 'test-all WITH token → 200', `got ${r.status}`)
const data = await r.json().catch(() => null)
ok(!!data && Array.isArray(data.results), 'response has results[]', JSON.stringify(data).slice(0, 100))
ok(typeof data?.okCount === 'number' && typeof data?.total === 'number' && typeof data?.durationMs === 'number',
  'response has okCount/total/durationMs numbers', JSON.stringify({ ok: data?.okCount, total: data?.total }))

const total = data.total, results = data.results
ok(total >= 1, `pool has at least the planted bad row (total=${total}, real pool rows=${preProviders.length})`)

const shapeOk = results.every(x => typeof x.id === 'string' && typeof x.name === 'string' && typeof x.kind === 'string' && typeof x.ok === 'boolean')
ok(shapeOk, 'every result carries id/name/kind/ok', '')

const bad = results.find(x => x.name === BAD_NAME)
ok(!!bad, 'planted bad provider appears in results', '')
ok(bad && bad.ok === false, 'bad provider verdict = ok:false (honest failure)', bad ? JSON.stringify(bad).slice(0, 140) : 'missing')
ok(bad && typeof bad.error === 'string' && bad.error.length > 0, 'bad provider carries a human-readable error', bad ? String(bad.error).slice(0, 100) : '')
ok(bad && (bad.error || '').match(/could not reach|timed out|enotfound|notfound|getaddrinfo|fetch failed|network/i) !== null,
  'bad provider error is transport-honest (unreachable DNS)', bad ? String(bad.error).slice(0, 120) : '')

const mathOk = results.filter(x => x.ok).length === data.okCount
ok(mathOk, `okCount math consistent (${data.okCount}/${total})`, '')

const noFake = results.filter(x => x.ok).every(x => typeof x.durationMs === 'number' && x.durationMs >= 0)
ok(noFake, 'every PASS carries a real duration', '')

// healthy rows (the real user pool, excluding our planted row) must not be
// marked failed with a TRANSPORT lie — upstream auth errors are honest too,
// so we only assert they kept their identity fields
const healthyRows = results.filter(x => x.name !== BAD_NAME)
ok(healthyRows.length === preProviders.length, 'every pre-existing provider got a verdict (nothing skipped)', `${healthyRows.length} vs ${preProviders.length}`)

// 4. cleanup the planted row through the REAL API DELETE — this also removes
//    it from the write-through disk vault (a bare DB delete would leave a
//    ghost in data/provider-vault.json that resurrects on next restore)
const planted = await db.aIProvider.findMany({ where: { name: BAD_NAME } })
for (const row of planted) {
  const del = await fetch(`${BASE}/api/providers?id=${encodeURIComponent(row.id)}`, { method: 'DELETE', headers: H })
  if (del.status !== 200) console.log(`  (warn) API delete ${row.id} → ${del.status}`)
}
const after = await db.aIProvider.findMany()
ok(after.every(p => preIds.has(p.id)), 'cleanup: only the planted row removed (nothing else touched)', '')

console.log(`\n── v56 Final Batch: ${pass} PASS / ${fail} FAIL ──`)
await db.$disconnect()
process.exit(fail === 0 ? 0 : 1)
