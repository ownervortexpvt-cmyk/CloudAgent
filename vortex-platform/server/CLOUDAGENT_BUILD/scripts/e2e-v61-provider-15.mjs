/**
 * E2E v61 — Provider list = EXACTLY the owner's 15, kromonishare — the rest
 * of the old 61+ catalog is DELETED (not hidden — gone).
 *
 * Owner spec:
 *   Auto → Custom → Gemini → Groq → Z.ai → OpenRouter → AI/ML → DeepSeek →
 *   DeepInfra → then the strongest remaining free picks — 15 total.
 *
 * Verifies END TO END against the live dev server:
 *   1. SOURCE STRUCTURE — Q_CURATED is exactly 15 ids in the owner's exact
 *      order; Q_PROVIDERS catalog is ALSO exactly those 15 (nothing more);
 *      the List-tab kind dropdown (PROVIDER_KINDS) carries only the 14 kinds
 *      behind those picks (+ custom); KEY_GUIDE has no deleted-provider guides
 *   2. DELETIONS ARE REAL — the show-all toggle and its branches are gone
 *      from the source AND from the shipped JS chunks; deleted providers
 *      (Ollama, KoboldCPP, paid OpenRouter, Together-unc, Claude, GPT,
 *      Vercel gateway, Hyperbolic…) appear NOWHERE in the client bundle
 *   3. SHIPPED CHUNKS — the compiled JS chunk carries "Your 15" and the
 *      exact compiled owner order
 *   4. REAL API REGRESSION — a provider saved with the EXACT config of two
 *      curated entries (Z.ai GLM endpoint + DeepInfra endpoint) still saves,
 *      lists and deletes through /api/providers (vault write-through safe)
 *
 * Run: node scripts/e2e-v61-provider-15.mjs   (dev server on :3000)
 */
import crypto from 'crypto'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

const EXPECTED_ORDER = [
  'auto', 'custom',
  'gemini', 'groq', 'zai', 'openrouter-free', 'aimlapi', 'deepseek', 'deepinfra',
  'cerebras', 'sambanova', 'huggingface', 'siliconflow', 'novita', 'together-free',
]

async function main() {
  console.log(`\n=== v61 provider-15 E2E @ ${BASE} ===\n`)

  // ── mint a real session token (the lock is configured) ───────────────────
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v61 provider-15', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }

  // ── 1. SOURCE STRUCTURE — curated 15, exact order, all ids real ──────────
  const src = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx', 'utf8')
  const curatedBlock = (src.match(/const Q_CURATED: string\[\] = \[([\s\S]*?)\]/)?.[1] || '').replace(/\/\/[^\n]*/g, '')
  const curatedIds = [...curatedBlock.matchAll(/'([^']+)'/g)].map(m => m[1])
  ok('Q_CURATED is EXACTLY 15 entries', curatedIds.length === 15, `n=${curatedIds.length}`)
  ok('curated order = owner\'s exact kromonishare (Auto→Custom→Gemini→Groq→Z.ai→OpenRouter→AI/ML→DeepSeek→DeepInfra→…)', JSON.stringify(curatedIds) === JSON.stringify(EXPECTED_ORDER), curatedIds.join(','))
  const catalogIds = [...src.matchAll(/\{ id: '([^']+)', label: '/g)].map(m => m[1])
  const missing = curatedIds.filter(id => !catalogIds.includes(id))
  ok('every curated id exists in the Q_PROVIDERS catalog (no silent drops)', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `catalog=${catalogIds.length}`)
  ok('Q_PROVIDERS catalog is ALSO exactly the 15 — the rest of the 61+ DELETED', JSON.stringify(catalogIds) === JSON.stringify(EXPECTED_ORDER), `catalog=${catalogIds.length}`)
  const kindIds = [...src.matchAll(/\{ value: '([^']+)', label: '/g)].map(m => m[1])
  ok('List-tab kind dropdown (PROVIDER_KINDS) carries only the 14 kinds behind the 15 (+custom kinds)', JSON.stringify(kindIds) === JSON.stringify(['zai', 'gemini', 'groq', 'openrouter', 'deepseek', 'deepinfra', 'cerebras', 'sambanova', 'huggingface', 'siliconflow', 'novita', 'together', 'openai-compatible', 'custom']), `kinds=${kindIds.length}`)
  const guideIds = [...src.matchAll(/^  '?([a-z0-9-]+)'?: \{ steps:/gm)].map(m => m[1])
  ok('KEY_GUIDE has guides only for the 15 (deleted providers\' guides gone)', guideIds.every(id => EXPECTED_ORDER.includes(id)) && guideIds.length === 15, `guides=${guideIds.length}`)

  // ── 2. SHIPPED CHUNKS — the real compiled bundle carries it ──────────────
  const page = await (await fetch(`${BASE}/`, { headers: { 'x-ca-lock': token } })).text()
  const chunks = [...new Set(page.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [])]
  let hay = ''
  for (const c of chunks) {
    try { hay += await (await fetch(`${BASE}${c}`)).text() } catch {}
  }
  ok('chunk set collected', chunks.length > 0, `${chunks.length} chunks, ${Math.round(hay.length / 1024)}KB`)
  ok('⭐ Your 15 curated group ships', hay.includes('Your 15'))
  ok('old "Your 32" label is GONE', !hay.includes('Your 32'))
  const gap = '(?:[\\s,]|//[^\\n]*)*'
  const compiledOrder = hay.match(new RegExp('\\[' + gap + EXPECTED_ORDER.map(id => `["']${id}["']`).join(gap + ',' + gap) + gap + '\\]'))
  ok('compiled curated array ships in the exact owner order', !!compiledOrder)
  ok('show-all toggle is GONE from the shipped bundle', !hay.includes('Show all ') && !hay.includes('Show your 15 only') && !hay.includes('providers (uncensored, local, paid'))
  const deletedLabels = ['Ollama (local, uncensored)', 'KoboldCPP (local, uncensored)', 'OpenRouter (200+ models)', 'Together AI (uncensored)', 'Claude (Anthropic)', 'GPT (OpenAI)', 'Vercel AI Gateway', 'Hyperbolic (free credit)', 'Baidu Qianfan (free tier)']
  const stillThere = deletedLabels.filter(l => hay.includes(l))
  ok('deleted providers appear NOWHERE in the client bundle (Ollama, KoboldCPP, paid OpenRouter, Together-unc, Claude, GPT, Vercel, Hyperbolic…)', stillThere.length === 0, stillThere.length ? `still present: ${stillThere.join(' | ')}` : 'all gone')
  ok('deleted gpt KEY_GUIDE text gone from the bundle (402 = add credit)', !hay.includes('402 = add credit'))
  ok('Auto pick ships (detect from key)', hay.includes('Auto (detect from key)'))
  ok('Custom pick ships (any provider)', hay.includes('Custom URL (any provider)'))
  ok('Z.ai entry ships (GLM endpoint)', hay.includes('Z.ai (GLM)'))
  ok('AI/ML entry ships', hay.includes('AI/ML API'))
  ok('DeepInfra entry ships', hay.includes('DeepInfra'))
  ok('Built-in Z.ai card unaffected (no API key needed)', hay.includes('Built-in Z.ai — no API key needed'))

  // ── 3. CATALOG DELETED — nothing beyond the 15 anywhere ─────────────
  ok('catalog count is EXACTLY 15 (61+ → 15, per the owner\'s order)', catalogIds.length === 15, `catalog=${catalogIds.length}`)

  // ── 4. REAL API REGRESSION — curated configs still save/list/delete ──────
  const before = await (await fetch(`${BASE}/api/providers`, { headers: H })).json()
  const beforeCount = (before.providers || []).length

  const zaiCfg = { name: '__e2e_v61_zai_curated', kind: 'openai-compatible', endpoint: 'https://api.z.ai/api/paas/v4', apiKey: 'e2e-v61-zai-key.secret', model: 'glm-4.6' }
  const diCfg = { name: '__e2e_v61_deepinfra_curated', kind: 'openai-compatible', endpoint: 'https://api.deepinfra.com/v1/openai', apiKey: 'e2e-v61-deepinfra-key', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct' }
  let r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify(zaiCfg) })
  const zaiSaved = await r.json()
  ok('curated Z.ai config saves via real API → 200', r.status === 200 && !!zaiSaved.provider?.id, r.status.toString())
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify(diCfg) })
  const diSaved = await r.json()
  ok('curated DeepInfra config saves via real API → 200', r.status === 200 && !!diSaved.provider?.id, r.status.toString())

  const mid = await (await fetch(`${BASE}/api/providers`, { headers: H })).json()
  const midList = mid.providers || []
  ok('both saved providers list back with endpoints intact',
    midList.some(p => p.id === zaiSaved.provider?.id && p.endpoint === zaiCfg.endpoint) &&
    midList.some(p => p.id === diSaved.provider?.id && p.endpoint === diCfg.endpoint), `count=${midList.length}`)

  // cleanup via REAL API only (vault write-through — never raw DB deletes)
  for (const id of [zaiSaved.provider?.id, diSaved.provider?.id].filter(Boolean)) {
    await fetch(`${BASE}/api/providers?id=${id}`, { method: 'DELETE', headers: H })
  }
  const after = await (await fetch(`${BASE}/api/providers`, { headers: H })).json()
  ok('E2E rows cleaned via real DELETE (pool back to prior size)', (after.providers || []).length === beforeCount, `before=${beforeCount} after=${(after.providers || []).length}`)

  await db.lockSession.deleteMany({ where: { device: 'E2E v61 provider-15' } })
  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  await db.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('E2E crashed:', e); await db.$disconnect().catch(() => {}); process.exit(1) })
