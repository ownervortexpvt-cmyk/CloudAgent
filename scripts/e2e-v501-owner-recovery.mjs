/**
 * E2E v50.1 — Owner Recovery (lock can never brick the builder again).
 *
 * User's live bug: after the platform restored an older DB snapshot, the
 * stored PIN stopped matching what the owner remembers → every unlock said
 * "Wrong PIN" → the whole builder (incl. AI add) was unreachable forever.
 * Fix: /api/lock action 'recover' { recoveryKey, newPin } — the long random
 * key the owner received through his private assistant chat rotates the lock.
 *
 * Non-destructive: the ORIGINAL lock_hash/lock_secret are captured up front
 * and RESTORED at the end; E2E sessions are cleaned; audit rows stay (they
 * are real events).
 *
 * Run: node scripts/e2e-v501-owner-recovery.mjs   (dev server on :3000)
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()
const RECOVERY_KEY = process.env.CA_OWNER_RECOVERY_KEY || 'tipCSdRyIn7CEHGTcSjV9J7Ay9BNt1xd'

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
function signToken(secret, now = Date.now()) {
  const payload = `v1.${now + 30 * 24 * 3600 * 1000}`
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
}

async function main() {
  console.log(`\n=== v50.1 owner-recovery E2E @ ${BASE} ===\n`)

  // ── capture original lock state (restored at the end) ────────────────────
  const origHash = (await db.userSetting.findUnique({ where: { key: 'lock_hash' } }))?.value
  const origSecret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  ok('original lock state captured', !!origHash && !!origSecret)

  // 1. lock is configured; normal unlock with a WRONG pin still 401s
  let r = await fetch(`${BASE}/api/lock`, { cache: 'no-store' })
  ok('GET /api/lock → configured', r.ok && (await r.json()).configured === true)
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unlock', pin: '99999' }) })
  const wrong = await r.json()
  ok('owner dilemma reproduced: correct-flow unlock → Wrong PIN', r.status === 401 && /wrong pin/i.test(wrong.error || ''), wrong.error)

  // 2. recovery with a garbage key → 401 + warning audit row
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover', recoveryKey: 'garbage-key-not-real-1234', newPin: '7777' }) })
  ok('recover with garbage key → 401', r.status === 401)
  const deniedCount = await db.auditLog.count({ where: { action: 'lock.recovery_denied' } })
  ok('denied recovery is audit-logged (warning)', deniedCount >= 1, `rows=${deniedCount}`)

  // 3. recovery with the REAL key but a too-short PIN → 400 (PIN rules apply)
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover', recoveryKey: RECOVERY_KEY, newPin: '12' }) })
  ok('recover with real key + short PIN → 400', r.status === 400)

  // 4. recovery with the REAL key + a proper new PIN → ok + token
  const NEW_PIN = '9514'
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover', recoveryKey: RECOVERY_KEY, newPin: NEW_PIN }) })
  const rec = await r.json()
  ok('recover with real key + new PIN → ok', r.status === 200 && rec.ok === true && rec.recovered === true, `status=${r.status}`)
  ok('recovery returns a session token (header channel)', typeof rec.token === 'string' && rec.token.length > 8)

  // 5. the recovered token REALLY opens the builder — AI add works end-to-end
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': rec.token }
  r = await fetch(`${BASE}/api/providers`, { headers: H })
  ok('recovered token reads /api/providers → 200', r.status === 200)
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: '__e2e_v501_recovery_add', kind: 'openai', baseURL: 'https://api-inference.modelscope.cn/v1', apiKey: 'ms-e2e-recovery-key', model: 'e2e-model' }) })
  const added = await r.json()
  ok('AI add works right after recovery → 200', r.status === 200 && added?.provider?.id, `status=${r.status}`)
  const addId = added?.provider?.id
  if (addId) await fetch(`${BASE}/api/providers?id=${addId}`, { method: 'DELETE', headers: H })

  // 6. old-secret tokens are dead (rotation killed every previous session)
  const oldToken = signToken(origSecret)
  await db.lockSession.create({ data: { tokenHash: sha256(oldToken), device: 'E2E v50.1 old-secret', ip: '127.0.0.1' } })
  r = await fetch(`${BASE}/api/usage`, { headers: { 'x-ca-lock': oldToken } })
  ok('old-secret token after rotation → 401 fail-closed', r.status === 401)
  ok('revocation marker present for the dead token', r.headers.get('x-ca-lock-revoked') === '1')

  // 7. the NEW PIN unlocks through the NORMAL door too (no recovery needed anymore)
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unlock', pin: NEW_PIN }) })
  const unl = await r.json()
  ok('normal unlock with the recovered PIN → ok + token', r.status === 200 && unl.ok === true && !!unl.token)

  // 8. critical audit row written for the successful recovery
  const recAudit = await db.auditLog.findFirst({ where: { action: 'lock.recovery', severity: 'critical' }, orderBy: { createdAt: 'desc' } })
  ok('successful recovery audit-logged (critical)', !!recAudit)

  // 9. rate limit: 3 recover attempts / 10 min per IP — the 4th is refused
  //    even with the correct key (brute-force ceiling, in-memory window)
  r = await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recover', recoveryKey: RECOVERY_KEY, newPin: '2468' }) })
  ok('4th recovery within window → 429 (rate limited)', r.status === 429, `status=${r.status}`)

  // ── RESTORE the original lock state (owner's data is his, not ours) ──────
  await db.userSetting.update({ where: { key: 'lock_hash' }, data: { value: origHash } })
  await db.userSetting.update({ where: { key: 'lock_secret' }, data: { value: origSecret } })
  const del = await db.lockSession.deleteMany({ where: { device: { contains: 'E2E v50.1' } } })
  const restored = (await db.userSetting.findUnique({ where: { key: 'lock_hash' } }))?.value === origHash
    && (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value === origSecret
  ok('original lock state restored', restored)
  ok('E2E sessions cleaned', del.count >= 0 && (await db.lockSession.count({ where: { device: { contains: 'E2E v50.1' } } })) === 0)

  // 10. restored state: the pre-existing middleware behavior is unchanged
  r = await fetch(`${BASE}/`, { redirect: 'manual' })
  ok('anonymous / still redirects to /lock', r.status === 307 && (r.headers.get('location') || '').includes('/lock'))

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  await db.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('E2E crashed:', e); await db.$disconnect().catch(() => {}); process.exit(1) })
