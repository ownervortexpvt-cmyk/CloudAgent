/**
 * E2E v68 — "Gemini 404 Models not found" heal batch:
 *   A.  🩺 GeminiProvider STALE-MODEL SELF-HEAL — a saved provider pointing
 *       at a RETIRED model (gemini-1.5-pro-latest) now survives: first call
 *       404s → ListModels → best live model retried → 200. Proven against a
 *       FAKE Gemini server (exact /v1beta shape) via POST /api/providers/test.
 *   B.  🛠 /api/providers/fix-model — NEW route: detects the retired name,
 *       PERSISTS the best live replacement, honest "still live" verdict when
 *       nothing is wrong, clean 400/401/404s, honest failure (no change) when
 *       the live list is unreachable.
 *   C.  📚 /api/providers/models for gemini — respects custom endpoints,
 *       strips the "models/" prefix, filters to chat-capable
 *       (embedding/tts/deprecated out), newest family first.
 *   D.  🧹 curated list refresh — the shipped Gemini quick-pick no longer
 *       offers ANY retired name (no gemini-1.5*, no -001 suffix); default is
 *       gemini-2.5-flash (source checks).
 *   E.  💬 AgentPanel v68 — chat transcript export (.md) + last-failed
 *       one-tap resend chip (source checks) — and the gateway-retry
 *       contract from v67 is still intact.
 *
 * Run: node scripts/e2e-v68-gemini-heal.mjs   (dev server on :3000)
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/* ── the fake Gemini server — exact /v1beta response shapes ─────────────── */
const calls = { list404: 0, listOk: 0, listModels: 0 }
const RETIRED = new Set(['gemini-1.5-pro-latest', 'gemini-2.0-flash-001', 'gemini-1.5-flash-002'])
const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'GET' && url.pathname === '/v1beta/models') {
    calls.listModels++
    res.end(JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-tts-001', supportedGenerationMethods: ['synthesizeSpeech'] },
        { name: 'models/gemini-2.0-flash-001', supportedGenerationMethods: ['generateContent'], deprecated: true },
      ],
    }))
    return
  }
  const mGen = url.pathname.match(/^\/v1beta\/models\/(.+):generateContent$/)
  if (req.method === 'POST' && mGen) {
    const model = decodeURIComponent(mGen[1])
    if (RETIRED.has(model)) {
      calls.list404++
      res.statusCode = 404
      res.end(JSON.stringify({ error: { code: 404, message: 'Models not found. Check the model name.', status: 'NOT_FOUND' } }))
      return
    }
    if (model === 'gemini-2.5-flash' || model === 'gemini-2.5-pro') {
      calls.listOk++
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try { JSON.parse(body) } catch { res.statusCode = 400; res.end('{"error":"bad json"}'); return }
        res.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        }))
      })
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: { code: 404, message: 'Models not found. Check the model name.', status: 'NOT_FOUND' } }))
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})
const listen = () => new Promise((r) => fake.listen(0, '127.0.0.1', r))
const port = await (async () => { await listen(); return fake.address().port })()
const FAKE = `http://127.0.0.1:${port}/v1beta`
const KEY = `e2e-v68-fake-gemini-key-${Date.now()}`

async function main() {
  console.log(`\n=== v68 Gemini-404-heal E2E @ ${BASE} (fake gemini :${port}) ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v68 gemini-heal', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
  const H0 = { 'Content-Type': 'application/json' }

  // pre-clean: leftovers from any aborted earlier run (E2E rows only)
  await db.aIProvider.deleteMany({ where: { name: { contains: 'E2E v68' } } })

  // ── create the saved provider pointing at the RETIRED model ─────────────
  let r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v68 Gemini (retired)', kind: 'gemini', apiKey: KEY, model: 'gemini-1.5-pro-latest', endpoint: FAKE }) })
  let j = await r.json().catch(() => ({}))
  ok('P1 saved gemini provider with RETIRED model created', r.status === 200 && !!j?.provider?.id, `status ${r.status} ${JSON.stringify(j).slice(0, 80)}`)
  const pid = j?.provider?.id

  // ════ A. the self-heal — retired model 404 → ListModels → live retry ════
  r = await fetch(`${BASE}/api/providers/test`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid }) })
  j = await r.json().catch(() => ({}))
  ok('A1 test PASSES through the heal (was the user\'s HTTP 404)', r.status === 200 && j.ok === true && j.reply === 'OK', `status ${r.status} ${JSON.stringify(j).slice(0, 110)}`)
  ok('A2 healed TIER-PRESERVING (1.5-pro → 2.5-pro)', j.model === 'gemini-2.5-pro', `got ${j.model}`)
  ok('A3 fake server saw exactly one retired-404 before the heal', calls.list404 === 1, `404s=${calls.list404}`)
  ok('A4 ListModels asked exactly once (heal sticks per instance)', calls.listModels === 1, `lists=${calls.listModels}`)
  ok('A5 retry landed on the live model', calls.listOk === 1, `oks=${calls.listOk}`)

  // ════ B. /api/providers/fix-model — detect + persist + honest verdicts ══
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid }) })
  j = await r.json().catch(() => ({}))
  ok('B1 fix-model detected the retired name + picked live best', r.status === 200 && j.ok === true && j.fixed === true, `status ${r.status} ${JSON.stringify(j).slice(0, 110)}`)
  ok('B2 persisted switch gemini-1.5-pro-latest → gemini-2.5-pro (tier kept)', j.from === 'gemini-1.5-pro-latest' && j.to === 'gemini-2.5-pro', `${j.from} → ${j.to}`)
  const row = await db.aIProvider.findUnique({ where: { id: pid } })
  ok('B3 DB row really re-pointed at the live model', row?.model === 'gemini-2.5-pro', `db=${row?.model}`)

  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid }) })
  j = await r.json().catch(() => ({}))
  ok('B4 second run is an honest no-op ("still live")', j.ok === true && j.fixed === false && j.model === 'gemini-2.5-pro', JSON.stringify(j).slice(0, 110))

  // live-list unreachable → honest failure, NOTHING changed
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v68 Gemini (dead endpoint)', kind: 'gemini', apiKey: KEY + 'x2', model: 'gemini-1.5-pro-latest', endpoint: 'http://127.0.0.1:9/v1beta' }) })
  const deadJ = await r.json().catch(() => ({}))
  const dead = { id: deadJ?.provider?.id }
  ok('P2 dead-endpoint provider created (control)', r.status === 200 && !!dead.id, `status ${r.status}`)
  const deadBefore = (await db.aIProvider.findUnique({ where: { id: dead.id } }))?.model
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: dead.id }) })
  j = await r.json().catch(() => ({}))
  ok('B5 unreachable live-list → ok:false with honest reason', r.status === 200 && j.ok === false && /Could not fetch/i.test(j.error || ''), JSON.stringify(j).slice(0, 110))
  ok('B6 control row untouched after the failed fix', (await db.aIProvider.findUnique({ where: { id: dead.id } }))?.model === deadBefore)

  // clean 400 / 404
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({}) })
  ok('B7 missing id → 400', r.status === 400, `got ${r.status}`)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'no-such-row-xyz' }) })
  ok('B8 unknown id → 404', r.status === 404, `got ${r.status}`)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H0, body: JSON.stringify({ id: pid }) })
  ok('B9 locked-out request → 401 (guard alive)', r.status === 401, `got ${r.status}`)

  // ════ C. models route — gemini filtering + prefix strip + sort ══════════
  r = await fetch(`${BASE}/api/providers/models`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid }) })
  j = await r.json().catch(() => ({}))
  const ids = (j.models || []).map((m) => m.id)
  ok('C1 models route live via custom endpoint', j.ok === true && j.source === 'live', `source=${j.source}`)
  ok('C2 chat models only — embedding/tts/deprecated filtered', Array.isArray(ids) && ids.length === 2 && ids.includes('gemini-2.5-flash') && ids.includes('gemini-2.5-pro'), JSON.stringify(ids))
  ok('C3 "models/" prefix stripped', ids.every((i) => !i.startsWith('models/')))
  ok('C4 newest family first (2.5-flash before 2.5-pro)', ids[0] === 'gemini-2.5-flash', JSON.stringify(ids))

  // ════ A6. the flash path — a retired FLASH heals to the flash family ═══
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v68 Gemini (retired flash)', kind: 'gemini', apiKey: KEY + 'x3', model: 'gemini-1.5-flash-002', endpoint: FAKE }) })
  const flashJ = await r.json().catch(() => ({}))
  const flashPid = flashJ?.provider?.id
  ok('P3 retired-FLASH provider created', r.status === 200 && !!flashPid, `status ${r.status}`)
  r = await fetch(`${BASE}/api/providers/test`, { method: 'POST', headers: H, body: JSON.stringify({ id: flashPid }) })
  j = await r.json().catch(() => ({}))
  ok('A6 retired flash heals to gemini-2.5-flash', j.ok === true && j.model === 'gemini-2.5-flash', JSON.stringify(j).slice(0, 110))
  ok('A7 both heals together: exactly 2 retired-404s so far', calls.list404 === 2, `404s=${calls.list404}`)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: flashPid }) })
  j = await r.json().catch(() => ({}))
  ok('A8 fix-model flash path: 1.5-flash-002 → 2.5-flash', j.ok === true && j.fixed === true && j.to === 'gemini-2.5-flash', JSON.stringify(j).slice(0, 110))

  // ════ D. curated quick-pick list — no retired names anywhere ════════════
  const dlgSrc = fs.readFileSync('src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx', 'utf8')
  const gemLine = dlgSrc.split('\n').find((l) => l.includes("value: 'gemini'")) || ''
  ok('D1 curated default is gemini-2.5-flash', /defaultModel:\s*'gemini-2\.5-flash'/.test(gemLine))
  ok('D2 NO retired name in the curated list', !/gemini-1\.5|flash-001|-002'/.test(gemLine), gemLine.slice(0, 100))
  const provRaw = fs.readFileSync('src/lib/ai/providers.ts', 'utf8')
  const provSrc = stripComments(provRaw)
  ok('D3 GeminiProvider self-heal shipped (ListModels + retry)', provSrc.includes('listChatModels') && provSrc.includes('FALLBACK_MODELS') && provSrc.includes('healModel404'))
  ok('D4 "models/" prefix tolerated on input (raw regex check)', provRaw.includes("replace(/^models\\//, '')"))

  // ════ E. AgentPanel v68 features (source structure) ══════════════════════
  const apSrc = stripComments(fs.readFileSync('src/components/cloud-agent/dashboard/AgentPanel.tsx', 'utf8'))
  ok('E1 chat transcript export shipped (exportChatMd + .md download)', apSrc.includes('function exportChatMd') && apSrc.includes("chat-${projectId.slice(0, 8)}"))
  ok('E2 last-failed one-tap resend chip shipped', apSrc.includes('lastFailed') && apSrc.includes('↻ Resend') && apSrc.includes('send(t)'))
  ok('E3 send(override) refactor safe — send button passes no event', apSrc.includes('function send(override?: string)') && apSrc.includes('onClick={() => send()}'))
  ok('E4 v67 gateway-retry contract intact (502/503/504 loop)', apSrc.includes('Gateway hiccup (HTTP') && apSrc.includes('RETRIES = 3'))

  // ════ cleanup — E2E rows only, owner data untouched ══════════════════════
  for (const id of [pid, dead.id, flashPid].filter(Boolean)) {
    await fetch(`${BASE}/api/providers?id=${id}`, { method: 'DELETE', headers: H })
  }
  const left = await db.aIProvider.findMany({ where: { name: { contains: 'E2E v68' } } })
  ok('Z1 cleanup — zero E2E v68 provider rows left', left.length === 0, `left=${left.length}`)
  const sess = await db.lockSession.deleteMany({ where: { device: 'E2E v68 gemini-heal' } })
  ok('Z2 lock session cleaned', sess.count >= 1, `deleted=${sess.count}`)

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  fake.close()
  await db.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('FATAL', e)
  fake.close()
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
