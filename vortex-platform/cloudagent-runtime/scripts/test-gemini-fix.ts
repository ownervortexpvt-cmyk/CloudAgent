/**
 * v72 Gemini 404 fix — proof test (mock Google API, no real key needed).
 *
 * Reproduces the OWNER's exact bug:
 *   ListModels returns gemini-3.8-flash (listed, staged → generateContent
 *   404s). OLD device path auto-selected it → "HTTP 404 — Model not found".
 *
 * Proves after the fix:
 *   1. Device path filters listed-but-not-callable models OUT
 *   2. Device verify floats a PROVEN-callable model to the front
 *   3. Server GeminiProvider 404 self-heal walks MULTIPLE candidates and
 *      heals to a model that actually answers (old code: single pick, died)
 */

let pass = 0, fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name} ${extra}`) }
}

/* ---------------- mock Google API ---------------- */
type Call = { method: string; url: string }
const calls: Call[] = []
// STAGED: listed by ListModels (2.5 even WITH the generateContent flag — the
// real-world trap) but generateContent still 404s. CALLABLE: truly answers.
const STAGED = new Set(['gemini-3.8-flash', 'gemini-2.5-flash'])
const CALLABLE = new Set(['gemini-3.7-flash', 'gemini-3.5-flash'])

const MOCK_MODELS = [
  { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['countTokens'] }, // ← listed, NO generateContent flag
  { name: 'models/gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/veo-3-generate', supportedGenerationMethods: ['predictLongRunning'] },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }, // ← flag mukhe listed, kintu staged → POST 404 (trap)
]

function mockResponse(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// @ts-ignore — bun allows reassigning global fetch
globalThis.fetch = async (input: any, init?: any) => {
  const url = String(input)
  const method = (init?.method || 'GET').toUpperCase()
  calls.push({ method, url })

  // ListModels (GET) — both ?key= and x-goog-api-key forms
  if (method === 'GET' && url.includes('/v1beta/models')) {
    return mockResponse(200, { models: MOCK_MODELS })
  }
  // generateContent (POST) — model resolution AFTER key check (like real Google)
  const m = url.match(/\/v1beta\/models\/([^:]+):generateContent/)
  if (m) {
    const model = decodeURIComponent(m[1])
    if (STAGED.has(model) || !CALLABLE.has(model)) {
      return mockResponse(404, { error: { code: 404, message: `Models '${model}' is not found for API version v1beta`, status: 'NOT_FOUND' } })
    }
    return mockResponse(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
  }
  return mockResponse(404, { error: { message: `unmocked ${method} ${url}` } })
}

/* ---------- 1. device path (what the owner's phone ran) ---------- */
console.log('\n[1] browser-detect (YOUR DEVICE Get path)')
const { browserDetectKey } = await import('/home/z/my-project/src/lib/ai/browser-detect')
calls.length = 0
const det = await browserDetectKey('AIzaFAKEKEYTEST0000000000', 'https://generativelanguage.googleapis.com/v1beta', 'gemini', 'Google Gemini')

check('detect ok', det.ok === true, JSON.stringify(det).slice(0, 200))
check('chat-capable list returned (3.8-flash excluded, rest kept)', (det.models?.length || 0) === 3, `got ${det.models?.length}: ${det.models?.map(m => m.id)}`)
check('gemini-3.8-flash (listed, not callable) FILTERED OUT', !det.models?.some(m => m.id === 'gemini-3.8-flash'))
check('embedding/veo filtered out', !det.models?.some(m => /embed|veo/.test(m.id)))
check('auto-selected model is PROVEN callable', det.model === 'gemini-3.7-flash', `got ${det.model}`)
check('verified model floated to FRONT of the list', det.models?.[0]?.id === 'gemini-3.7-flash', `got ${det.models?.[0]?.id}`)
const genPosts = calls.filter(c => c.method === 'POST' && c.url.includes(':generateContent')).map(c => decodeURIComponent(c.url.match(/models\/([^:]+):/)?.[1] || ''))
check('device verify: staged top model 404 → fell through to next best', JSON.stringify(genPosts) === JSON.stringify(['gemini-2.5-flash', 'gemini-3.7-flash']), JSON.stringify(genPosts))

/* ---------- 2. server path: GeminiProvider self-heal ---------- */
console.log('\n[2] GeminiProvider 404 self-heal (server)')
const { GeminiProvider } = await import('/home/z/my-project/src/lib/ai/providers')

// Scenario A — the staged trap: FALLBACK pick (gemini-2.5-flash) is listed
// with generateContent flag but POSTs 404 (staged); gemini-3.5-flash works.
// OLD code: healed once to gemini-2.5-flash → retry 404 → TOTAL FAILURE.
const p = new GeminiProvider({ apiKey: 'AIzaFAKEKEYTEST0000000000', model: 'gemini-3.8-flash' })
calls.length = 0
const r = await p.chat([{ role: 'user', content: 'Say OK' }], { maxTokens: 16 })
const posted = calls.filter(c => c.method === 'POST').map(c => decodeURIComponent(c.url.match(/models\/([^:]+):/)?.[1] || ''))
check('chat succeeded despite dead default model', r.content === 'OK', `got "${r.content}"`)
check('tried dead model first', posted[0] === 'gemini-3.8-flash', JSON.stringify(posted))
check('walked past STAGED 2.5 fallback (listed-with-flag yet 404)', JSON.stringify(posted) === JSON.stringify(['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.7-flash']), JSON.stringify(posted))
check('heal stuck on the callable model', (p as any).model === 'gemini-3.7-flash', `got ${(p as any).model}`)

// Scenario B — nothing callable at all → honest 404 verdict (no hang, no lie)
const p2 = new GeminiProvider({ apiKey: 'AIzaFAKEKEYTEST0000000000', model: 'gemini-3.8-flash' })
CALLABLE.clear()
let err: any = null
try { await p2.chat([{ role: 'user', content: 'hi' }], { maxTokens: 16 }) } catch (e: any) { err = e }
check('all-candidates-404 → honest HTTP 404 error thrown', !!err && /^HTTP 404\b/.test(String(err?.message)), String(err?.message).slice(0, 120))
CALLABLE.add('gemini-3.7-flash'); CALLABLE.add('gemini-3.5-flash')

/* ---------- 3. server detect path (key-detect.ts) ---------- */
console.log('\n[3] server detectKey (auto-detect / quick-setup fallback)')
const { detectKey } = await import('/home/z/my-project/src/lib/ai/key-detect')
const det2 = await detectKey('AIzaFAKEKEYTEST0000000000')
check('server detect ok', det2.ok === true, det2.error || '')
check('server detect excludes staged model', !det2.detected?.models?.some(m => m.id === 'gemini-3.8-flash'))
check('server detect default is callable', det2.detected?.models?.[0]?.id === 'gemini-3.7-flash', `got ${det2.detected?.models?.[0]?.id}`)

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`)
process.exit(fail > 0 ? 1 : 0)
