/**
 * E2E — /api/providers/test (the server-side provider Test route that was
 * missing, causing "http 502" / dead-ends in the Add-Provider flow).
 *
 * Proves, against the LIVE server:
 *   1. happy path through a REAL OpenAI-compatible HTTP provider (local mock)
 *   2. saved-provider flow: id-only call decrypts the stored key (no raw key
 *      in the body) and still completes a real generation
 *   3. unreachable endpoint → clean "could not reach" classification
 *   4. custom kind without endpoint → clean 400
 *   5. missing model → clean 400
 *   6. built-in Z.ai provider → REAL AI reply from the platform SDK
 *
 * Run: node scripts/e2e-v252-provider-test.mjs
 */
import http from 'http'
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const MOCK_PORT = 4599
const db = new PrismaClient()

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

// ── minimal but REAL OpenAI-compatible provider ─────────────────────────────
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    const auth = req.headers['authorization'] || ''
    if (!auth.startsWith('Bearer sk-e2e-')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-e2e', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    }))
  })
})

// ── lock session (mint token from the server's own secret, like v25.1) ──────
function signToken(secret, now = Date.now()) {
  const expiry = now + 30 * 24 * 60 * 60 * 1000
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ca-lock': global.TOKEN },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

async function main() {
  console.log(`\n=== /api/providers/test E2E @ ${BASE} ===\n`)

  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r))

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v25.2 provider-test', ip: '127.0.0.1' },
  })

  // 1. happy path — real HTTP provider
  const t1 = await api('/api/providers/test', {
    kind: 'openai-compatible', endpoint: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'sk-e2e-test', model: 'test-model',
  })
  ok('real provider → ok:true + reply', t1.status === 200 && t1.data?.ok === true && t1.data.reply === 'OK', JSON.stringify(t1.data?.reply) + ` ${t1.data?.durationMs}ms`)

  // 2. saved-provider flow — id only, key decrypted server-side
  const { encrypt } = await import('./encrypt-helper.mjs')
  let tempId = null
  try {
    const enc = encrypt('sk-e2e-test')
    const row = await db.aIProvider.create({
      data: { name: 'E2E saved test', kind: 'openai-compatible', endpoint: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKeyEnc: enc, model: 'test-model' },
    })
    tempId = row.id
    const t2 = await api('/api/providers/test', { id: tempId })
    ok('saved provider (id only, no raw key) → ok:true', t2.status === 200 && t2.data?.ok === true, JSON.stringify(t2.data?.reply))
  } finally {
    if (tempId) await db.aIProvider.delete({ where: { id: tempId } }).catch(() => {})
  }

  // 3. unreachable endpoint → classified network error
  const t3 = await api('/api/providers/test', {
    kind: 'openai-compatible', endpoint: 'http://127.0.0.1:9/v1', apiKey: 'sk-e2e-test', model: 'x',
  })
  ok('unreachable endpoint → ok:false + "could not reach"', t3.status === 200 && t3.data?.ok === false && /could not reach/i.test(t3.data.error || ''), (t3.data?.error || '').slice(0, 80))

  // 4. custom without endpoint → 400
  const t4 = await api('/api/providers/test', { kind: 'custom', apiKey: 'sk-e2e-test', model: 'x' })
  ok('custom without endpoint → 400 clean', t4.status === 400 && !t4.data?.ok, t4.data?.error || '')

  // 5. missing model → 400
  const t5 = await api('/api/providers/test', { kind: 'openai-compatible', apiKey: 'sk-e2e-test' })
  ok('missing model → 400 clean', t5.status === 400 && /model/i.test(t5.data?.error || ''), t5.data?.error || '')

  // 6. wrong key against the real mock → HTTP 401 preserved
  const t6 = await api('/api/providers/test', {
    kind: 'openai-compatible', endpoint: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'sk-wrong-key', model: 'x',
  })
  ok('wrong key → ok:false with upstream 401 status', t6.data?.ok === false && t6.data?.status === 401, `status=${t6.data?.status}`)

  // 7. built-in Z.ai → REAL AI generation
  const t7 = await api('/api/providers/test', { kind: 'zai', model: 'glm-4.6' })
  ok('built-in Z.ai → REAL reply', t7.status === 200 && t7.data?.ok === true && (t7.data.reply || '').length > 0, `"${(t7.data?.reply || '').slice(0, 40)}" ${t7.data?.durationMs}ms`)

  // cleanup the E2E session row
  await db.lockSession.deleteMany({ where: { device: 'E2E v25.2 provider-test' } }).catch(() => {})
  mock.close()

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  process.exitCode = fail ? 1 : 0
}

main()
  .catch(e => { console.error('E2E crashed:', e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
