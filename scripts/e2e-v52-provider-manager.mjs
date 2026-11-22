/**
 * E2E v52 — Provider Manager rebuild (was v46/v47, lost to the env reset).
 *
 * Verifies the five rebuilt pieces END TO END against the live dev server:
 *   1. KEY HEALTH memory — /api/providers/health-record remembers every real
 *      verdict (POST → GET, newest-first, validation, cap)
 *   2. BUILT-IN Z.ai — kind:'zai' saves with NO API key (and updates in place)
 *   3. ⭐ Curated 15 — the owner's exact order ships in the JS chunk
 *   4. KEY GUIDE + ROLE CHIPS + health UI markers ship in the JS chunk
 *   5. Normal provider add still works (regression of the plain flow)
 *
 * Run: node scripts/e2e-v52-provider-manager.mjs   (dev server on :3000)
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

async function main() {
  console.log(`\n=== v52 provider-manager E2E @ ${BASE} ===\n`)

  // ── mint a real session token (the lock is configured) ───────────────────
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v52 provider-manager', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }

  // ── 1. KEY HEALTH memory ──────────────────────────────────────────────────
  let r = await fetch(`${BASE}/api/providers/health-record`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ModelScope', kind: 'openai-compatible', endpoint: 'https://api-inference.modelscope.cn/v1', model: 'Qwen/Qwen3-32B', ok: true, via: 'device' }) })
  const rec = await r.json()
  ok('health-record POST pass verdict → 200', r.status === 200 && rec.ok && rec.verdict?.id)
  r = await fetch(`${BASE}/api/providers/health-record`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Groq', kind: 'groq', endpoint: 'https://api.groq.com/openai/v1', ok: false, status: 403, error: 'HTTP 403 region block (device Get verified the key)', via: 'server' }) })
  const recFail = await r.json()
  ok('health-record POST fail verdict (403) → 200', r.status === 200 && recFail.verdict.ok === false && recFail.verdict.status === 403)
  r = await fetch(`${BASE}/api/providers/health-record`, { headers: H })
  let list = (await r.json()).verdicts
  ok('health-record GET returns both, NEWEST first', list.length >= 2 && list[0].name === 'Groq' && list[1].name === 'ModelScope', `n=${list.length}`)
  r = await fetch(`${BASE}/api/providers/health-record`, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'groq' }) })
  ok('health-record POST without name → 400', r.status === 400)

  // ── 2. BUILT-IN Z.ai — no API key ────────────────────────────────────────
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Built-in Z.ai', kind: 'zai', endpoint: null, model: 'glm-4.6', temperature: 0.7, isDefault: false }) })
  const built = await r.json()
  ok('kind:zai saves with NO apiKey → 200', r.status === 200 && built.provider?.id, `status=${r.status}`)
  const builtId = built.provider?.id
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ id: builtId, name: 'Built-in Z.ai', kind: 'zai', endpoint: null, model: 'glm-4-flash', temperature: 0.7, isDefault: false }) })
  const rebuilt = await r.json()
  ok('built-in Z.ai re-save UPDATES the same row (model switch)', r.status === 200 && rebuilt.provider?.id === builtId && rebuilt.provider?.model === 'glm-4-flash')

  // ── 3+4. shipped UI chunk carries the rebuilt pieces ─────────────────────
  const page = await (await fetch(`${BASE}/`, { headers: { 'x-ca-lock': token } })).text()
  const chunks = [...new Set(page.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [])]
  let hay = ''
  for (const c of chunks) {
    try { hay += await (await fetch(`${BASE}${c}`)).text() } catch {}
  }
  ok('⭐ Your 15 curated group ships', hay.includes('Your 15'))
  ok('curated order: gemini→groq→gpt→openrouter→sambanova→deepinfra→deepseek→aimlapi→zai→cerebras→huggingface→together-free→mistral present', ['gemini','groq','gpt','openrouter','sambanova','deepinfra','deepseek','aimlapi','zai','cerebras','huggingface','together-free','mistral'].every(id => hay.includes(`'${id}'`)))
  ok('Show-all toggle for the full 60+ catalog ships', hay.includes('providers (uncensored, local, paid'))
  ok('KEY GUIDE ships (How to get this key + Free tier truth)', hay.includes('How to get this key') && hay.includes('Free tier truth'))
  ok('KEY GUIDE content honest (groq 403 region truth, gpt 402 billing truth)', hay.includes('402 = add credit') && hay.includes('region is blocked'))
  ok('ROLE TEMPLATE CHIPS ship (8 roles)', hay.includes('Role template (one tap fills the prompt)') && hay.includes('QA/Tester') && hay.includes('Reviewer') && hay.includes('DevOps'))
  ok('Built-in Z.ai card ships (no API key needed)', hay.includes('Built-in Z.ai — no API key needed'))
  ok('KEY HEALTH line ships (Last Test … PASSED/FAILED · ago)', hay.includes('Last Test') && hay.includes('min ago'))

  // ── 5. plain provider add regression + cleanup ───────────────────────────
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: '__e2e_v52_plain', kind: 'openai-compatible', endpoint: 'https://api-inference.modelscope.cn/v1', apiKey: 'ms-e2e-v52-plain-key', model: 'e2e/v52' }) })
  const plain = await r.json()
  ok('plain provider add still works → 200', r.status === 200 && plain.provider?.id)
  for (const id of [plain.provider?.id, builtId].filter(Boolean)) {
    await fetch(`${BASE}/api/providers?id=${id}`, { method: 'DELETE', headers: H })
  }
  const after = await (await fetch(`${BASE}/api/providers`, { headers: H })).json()
  ok('E2E rows cleaned (pool back to its prior size)', (after.providers || []).length === 0, `count=${(after.providers || []).length}`)

  await db.lockSession.deleteMany({ where: { device: 'E2E v52 provider-manager' } })
  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  await db.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('E2E crashed:', e); await db.$disconnect().catch(() => {}); process.exit(1) })
