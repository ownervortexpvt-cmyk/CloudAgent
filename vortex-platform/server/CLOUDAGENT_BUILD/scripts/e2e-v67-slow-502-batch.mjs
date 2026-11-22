/**
 * E2E v67 — "slow / 502 / network-error / second-screen" batch:
 *   A.  🌐 /api/custom-domains/lookup — NEW public route (was allowlisted but
 *       never existed → live gateway 404s). Honest, leak-free responses.
 *   B.  🔒 isPublicPath hardening — '/api/lockxyz'-style paths are NO LONGER
 *       public (middleware must 401 them); real public paths still open.
 *   C.  🛡️ in-route guards ALIVE — providers/test, providers/test-all,
 *       backup GET+POST, secrets/test now `await` isUnlockedRequest
 *       (source-structure + runtime 401 without token + 200-shape with token)
 *   D.  🚑 middleware DB-outage → honest 503 + Retry-After (source-structure;
 *       runtime DB-kill deliberately NOT tested to protect owner data)
 *   E.  ♻️ gateway-retry — AgentPanel + MultiAgentPanel initial POSTs retry
 *       502/503/504 + network throws with honest "hiccup" messages
 *       (source-structure)
 *   F.  🏷️ namesMatch false-mismatch fix — 'Google Gemini' vs
 *       'Gemini (Google)' (same provider) no longer triggers the absurd
 *       "Connected to X — NOT Y" toast; DeepSeek vs DeepInfra still warns
 *   G.  ⚙️ service worker v67 — stale-shell guard re-delivered: API bypass,
 *       manual-redirect auth handling, only-clean-caching, 30-min staleness
 *       + honest interstitial, old-cache nuke on activate
 *   H.  📝 409 duplicate-key UX + lock 400 action list
 *
 * Run: node scripts/e2e-v67-slow-502-batch.mjs   (dev server on :3000)
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

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

/** the EXACT algorithm shipped in ProviderManagerDialog (kept in sync) */
function namesMatch(detected, chosenLabel) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = norm(detected)
  const b = norm(chosenLabel)
  if (!a || !b) return true
  if (a === b || a.includes(b) || b.includes(a)) return true
  for (let len = Math.min(a.length, 12); len >= 5; len--) {
    for (let i = 0; i + len <= a.length; i++) {
      if (b.includes(a.slice(i, i + len))) return true
    }
  }
  return false
}

async function main() {
  console.log(`\n=== v67 slow/502/network-error batch E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v67 slow-502 batch', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
  const H0 = { 'Content-Type': 'application/json' } // no lock header

  // ════ A. custom-domains/lookup — the missing public route ═══════════════
  let r = await fetch(`${BASE}/api/custom-domains/lookup?host=shop.example.com`)
  let j = await r.json().catch(() => ({}))
  ok('A1 lookup without lock (public) → 200', r.status === 200, `got ${r.status}`)
  ok('A2 lookup honest shape', j.ok === true && j.mapped === false && typeof j.reason === 'string', JSON.stringify(j).slice(0, 90))
  ok('A3 lookup echoes host', j.host === 'shop.example.com')
  r = await fetch(`${BASE}/api/custom-domains/lookup?domain=Bad_Host!`)
  j = await r.json().catch(() => ({}))
  ok('A4 malformed host → still 200 honest (gateway-safe)', r.status === 200 && j.ok === true && j.mapped === false, `got ${r.status}`)
  r = await fetch(`${BASE}/api/custom-domains/lookup`)
  j = await r.json().catch(() => ({}))
  ok('A5 missing host param → 200, no crash', r.status === 200 && j.mapped === false, `got ${r.status}`)
  r = await fetch(`${BASE}/api/custom-domains/lookup?host=x.example.com`, { headers: H })
  ok('A6 lookup WITH lock also fine', r.status === 200)

  // ════ B. isPublicPath hardening ═════════════════════════════════════════
  r = await fetch(`${BASE}/api/lockxyz`, { headers: H0 })
  ok('B1 /api/lockxyz NOT public → 401 (was public-404)', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/internal-bogus`, { headers: H0 })
  ok('B2 /api/internal-bogus NOT public → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: H0, body: JSON.stringify({ action: 'bogus' }) })
  const lockErr = await r.json().catch(() => ({}))
  ok('B3 real /api/lock still public (own 400 with recover listed)', r.status === 400 && /recover/.test(lockErr.error || ''), `got ${r.status} ${JSON.stringify(lockErr).slice(0, 80)}`)
  r = await fetch(`${BASE}/api/analytics/hit`, { method: 'POST', headers: H0, body: JSON.stringify({}) })
  ok('B4 analytics beacon still public (not 401)', r.status !== 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/lock/passkey`, { method: 'POST', headers: H0, body: JSON.stringify({ action: 'bogus' }) })
  ok('B5 /api/lock/passkey reachable (route-level 401, not middleware page-redirect)', r.status === 401, `got ${r.status}`)
  // real subpath semantics: /api/lock/subpaths must stay public at middleware
  r = await fetch(`${BASE}/api/lock/sessions`, { headers: H0 })
  ok('B6 /api/lock/sessions reachable (401 from its own guard, not blocked)', r.status === 401, `got ${r.status}`)

  // ════ C. in-route guards alive (the 5 missing awaits) ══════════════════
  r = await fetch(`${BASE}/api/providers/test`, { method: 'POST', headers: H0, body: JSON.stringify({ id: 'x' }) })
  ok('C1 POST /api/providers/test no-lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/providers/test-all`, { method: 'POST', headers: H0 })
  ok('C2 POST /api/providers/test-all no-lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/backup`, { headers: H0 })
  ok('C3 GET /api/backup no-lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/backup`, { method: 'POST', headers: H0, body: JSON.stringify({ backup: {} }) })
  ok('C4 POST /api/backup no-lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H0, body: JSON.stringify({ key: 'X' }) })
  ok('C5 POST /api/secrets/test no-lock → 401', r.status === 401, `got ${r.status}`)
  // happy paths still work with a valid token (await didn't break flow)
  r = await fetch(`${BASE}/api/backup`, { headers: H })
  ok('C6 GET /api/backup with lock → 200 JSON', r.status === 200, `got ${r.status}`)
  j = await r.json().catch(() => ({}))
  ok('C7 backup payload shape intact', typeof j === 'object' && ('backup' in j || 'projects' in j || 'generatedAt' in j || j.ok === true), Object.keys(j).slice(0, 5).join(','))
  // source-structure: all five guards really await now
  const guardFiles = [
    'src/app/api/providers/test/route.ts',
    'src/app/api/providers/test-all/route.ts',
    'src/app/api/backup/route.ts',
    'src/app/api/secrets/test/route.ts',
  ]
  for (const f of guardFiles) {
    const src = stripComments(fs.readFileSync(f, 'utf8'))
    ok(`C8 ${f.split('/').slice(-3).join('/')} uses (await isUnlockedRequest)`, src.includes('await isUnlockedRequest(req)') && !src.includes('if (!isUnlockedRequest(req))'))
  }

  // ════ D. middleware 503-on-DB-outage (source-structure) ═════════════════
  {
    const mw = stripComments(fs.readFileSync('src/middleware.ts', 'utf8'))
    ok('D1 middleware returns 503 on DB outage', mw.includes('503'))
    ok('D2 middleware sets Retry-After', mw.includes("Retry-After"))
    ok('D3 middleware logs the DB failure', mw.includes("console.error('[lock-middleware]"))
    ok('D4 pages still fail closed (no unlock-on-error)', !/status: 200/.test(mw))
  }

  // ════ E. gateway-retry in both panels ═══════════════════════════════════
  {
    const ap = stripComments(fs.readFileSync('src/components/cloud-agent/dashboard/AgentPanel.tsx', 'utf8'))
    ok('E1 AgentPanel retries gateway errors', ap.includes('502 || r.status === 503 || r.status === 504'))
    ok('E2 AgentPanel bounded retries', /RETRIES = 3/.test(ap))
    ok('E3 AgentPanel honest hiccup message', ap.includes('Gateway hiccup'))
    ok('E4 AgentPanel network-throw retry', ap.includes('Network hiccup'))
    const mp = stripComments(fs.readFileSync('src/components/cloud-agent/multiagent/MultiAgentPanel.tsx', 'utf8'))
    ok('E5 MultiAgentPanel retries gateway errors', mp.includes('502 || r.status === 503 || r.status === 504'))
    ok('E6 MultiAgentPanel honest hiccup message', mp.includes('Gateway hiccup'))
  }

  // ════ F. namesMatch truth-table ═════════════════════════════════════════
  ok('F1 Gemini (Google) vs Google Gemini → SAME (no absurd toast)', namesMatch('Google Gemini', 'Gemini (Google)') === true)
  ok('F2 Gemini vs Gemini', namesMatch('Gemini', 'Gemini (Google)') === true)
  ok('F3 DeepSeek vs DeepInfra still warns', namesMatch('DeepSeek', 'DeepInfra') === false)
  ok('F4 SambaNova vs ModelScope still warns', namesMatch('ModelScope', 'SambaNova') === false)
  ok('F5 SambaNova vs SambaNova matches', namesMatch('SambaNova', 'SambaNova') === true)
  ok('F6 OpenRouter vs OpenRouter Free matches', namesMatch('OpenRouter', 'OpenRouter (free)') === true)
  ok('F7 Hugging Face vs HuggingFace matches', namesMatch('HuggingFace', 'Hugging Face') === true)
  ok('F8 Together vs Together (free) matches', namesMatch('Together', 'Together (free)') === true)
  ok('F9 Z.ai vs Groq warns', namesMatch('Groq', 'Z.ai') === false)
  ok('F10 shipped code contains the chunk-probe fix', (() => {
    const src = stripComments(fs.readFileSync('src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx', 'utf8'))
    return src.includes('for (let len = Math.min(a.length, 12); len >= 5; len--)')
  })())
  ok('F11 shipped 409 copy is truth-first', (() => {
    const src = stripComments(fs.readFileSync('src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx', 'utf8'))
    return src.includes('no need to add it again') && src.includes('ready to use')
  })())

  // ════ G. service worker v67 ═════════════════════════════════════════════
  r = await fetch(`${BASE}/sw-builder.js`)
  const sw = await r.text()
  ok('G1 SW served 200 as JS', r.status === 200 && /javascript|ecmascript/i.test(r.headers.get('content-type') || ''), r.headers.get('content-type'))
  // v67 HARDENING: the SW must PARSE as plain JavaScript — a TS annotation
  // slipped in during this round and the browser rejected the whole worker
  // ("ServiceWorker script evaluation failed") while string checks stayed green
  let swParses = false
  try { new Function(sw); swParses = true } catch {}
  ok('G1b SW parses as plain JavaScript (no TS-isms)', swParses)
  ok('G2 SW cache bumped to v3', sw.includes("const CACHE = 'ca-builder-v3'"))
  ok('G3 SW never touches APIs', /pathname\.startsWith\('\/api\/'\)\) return/.test(sw))
  ok('G4 SW non-GET bypass', sw.includes("req.method !== 'GET'"))
  ok('G5 SW auth bounces pass through manual', sw.includes("redirect: 'manual'"))
  ok('G6 SW caches only clean 200s', sw.includes('res.ok && !res.redirected'))
  ok('G7 SW 30-min staleness guard', sw.includes('STALE_MS') && sw.includes('30 * 60 * 1000'))
  ok('G8 SW honest interstitial with real age', sw.includes('honestInterstitial') && sw.includes('min</b> old'))
  ok('G9 SW interstitial has cache-busting Retry', sw.includes("'?retry=' + Date.now()"))
  ok('G10 SW nukes foreign caches on activate', /keys\.filter\(k => k !== CACHE\)/.test(sw))
  ok('G11 SW shell timeout guard (shells only, APIs untouched)', sw.includes('AbortSignal.timeout(NET_TIMEOUT_MS)') && sw.includes('10_000'))
  ok('G12 SW freshness marker written', sw.includes('/__ca_shell_ts'))
  {
    const layout = fs.readFileSync('src/app/layout.tsx', 'utf8')
    ok('G13 registration uses updateViaCache none', layout.includes("{updateViaCache:'none'}"))
    ok('G14 registration checks for SW updates on boot', layout.includes('r.update()'))
  }

  // ════ H. lock 400 message ═══════════════════════════════════════════════
  ok('H1 lock 400 lists recover (B3 double-checked)', /recover/.test(lockErr.error || ''))

  // ════ live-traffic sanity: the main flows still work ════════════════════
  r = await fetch(`${BASE}/api/providers`, { headers: H })
  j = await r.json().catch(() => ({}))
  ok('I1 providers list loads', r.status === 200 && Array.isArray(j.providers))
  r = await fetch(`${BASE}/api/agent/resume`, { method: 'POST', headers: H, body: JSON.stringify({ runId: 'e2e-nonexistent', from: 0 }) })
  ok('I2 resume endpoint reachable (404 for unknown run)', r.status === 404, `got ${r.status}`)
  r = await fetch(`${BASE}/lock`, { redirect: 'manual' })
  ok('I3 lock page serves', r.status === 200, `got ${r.status}`)

  // ── cleanup: remove the E2E session (owner data untouched) ──────────────
  await db.lockSession.deleteMany({ where: { device: 'E2E v67 slow-502 batch' } })

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
