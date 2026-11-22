/**
 * E2E v25.1 — Embedded-Safe Lock (token header channel).
 *
 * Proves the exact scenario from the user's live bug: the session cookie is
 * unavailable, so every request must work through the x-ca-lock header —
 * with the SAME security (HMAC + live session registry, fail-closed).
 *
 * We cannot know the owner's PIN, so the suite mints a real signed token
 * straight from lock_secret (identical HMAC the server issues) and
 * registers it in the session registry — then exercises the middleware,
 * APIs, verify, revocation and logout through the header channel ONLY.
 *
 * Run: node scripts/e2e-v251-lock-embed.mjs
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

function signToken(secret, now = Date.now()) {
  const expiry = now + 30 * 24 * 60 * 60 * 1000
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

async function main() {
  console.log(`\n=== v25.1 embedded-safe lock E2E @ ${BASE} ===\n`)

  // 0. sanity: lock is configured
  const st = await fetch(`${BASE}/api/lock`, { cache: 'no-store' })
  const stj = await st.json()
  ok('GET /api/lock → configured', st.ok && stj.configured === true, `configured=${stj.configured}`)

  // mint a REAL token from the server's own secret + register the session
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  ok('lock_secret present', !!secret)
  const token = signToken(secret)
  const tokenHash = sha256(token)
  await db.lockSession.upsert({
    where: { tokenHash },
    update: { lastSeenAt: new Date(), device: 'E2E v25.1 header test' },
    create: { tokenHash, device: 'E2E v25.1 header test', ip: '127.0.0.1' },
  })
  const H = { 'x-ca-lock': token }

  // 1. page navigation through the HEADER channel (the exact embedded case)
  const home = await fetch(`${BASE}/`, { headers: H, redirect: 'manual' })
  ok('GET / with header token → 200', home.status === 200, `status=${home.status}`)
  const homeHtml = await home.text()
  ok('dashboard HTML served (bridge marker present)', homeHtml.includes('data-ca-token-bridge'), '')

  // 2. same navigation WITHOUT any token → bounced to /lock (lock still real)
  const anon = await fetch(`${BASE}/`, { redirect: 'manual' })
  const anonLoc = anon.headers.get('location') || ''
  ok('GET / anonymous → redirected to /lock', anon.status === 307 && anonLoc.includes('/lock'), `${anon.status} ${anonLoc}`)

  // 3. APIs through the header channel
  const apiH = await fetch(`${BASE}/api/usage`, { headers: H })
  ok('GET /api/usage with header token → 200', apiH.status === 200, `status=${apiH.status}`)
  const apiA = await fetch(`${BASE}/api/usage`)
  ok('GET /api/usage anonymous → 401', apiA.status === 401, `status=${apiA.status}`)

  // 4. verify action (what the /lock page auto-resume uses)
  const vf = await fetch(`${BASE}/api/lock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ action: 'verify' }),
  })
  const vfj = await vf.json()
  ok('POST verify with header token → valid:true', vf.ok && vfj.valid === true, `valid=${vfj.valid}`)

  const vBad = await fetch(`${BASE}/api/lock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ca-lock': 'v1.9999999999999.deadbeef' },
    body: JSON.stringify({ action: 'verify' }),
  })
  const vBadj = await vBad.json()
  ok('POST verify with garbage token → valid:false', vBad.ok && vBadj.valid === false, `valid=${vBadj.valid}`)

  // 5. tampered/forged token on a protected API → 401 + revoked marker
  const forged = await fetch(`${BASE}/api/usage`, { headers: { 'x-ca-lock': 'v1.9999999999999.deadbeef' } })
  ok('forged token → 401', forged.status === 401, `status=${forged.status}`)
  ok('forged token → x-ca-lock-revoked marker', forged.headers.get('x-ca-lock-revoked') === '1', '')

  // 6. REGISTRY REVOCATION fail-closed: valid HMAC but no session row → 401
  await db.lockSession.delete({ where: { tokenHash } })
  const revoked = await fetch(`${BASE}/api/usage`, { headers: H })
  ok('revoked session (HMAC valid) → 401 fail-closed', revoked.status === 401, `status=${revoked.status}`)
  ok('revoked session → revoked marker for the client', revoked.headers.get('x-ca-lock-revoked') === '1', '')

  // 7. wrong PIN is still rejected through the header channel (1 attempt only — rate-limit friendly)
  await db.lockSession.upsert({
    where: { tokenHash }, update: { lastSeenAt: new Date() }, create: { tokenHash, device: 'E2E v25.1', ip: '127.0.0.1' },
  })

  // 7b. sessions list marks THIS device correctly through the header channel
  const sess = await fetch(`${BASE}/api/lock/sessions`, { headers: H })
  const sessj = await sess.json().catch(() => ({}))
  const mine = (sessj.sessions || []).find(s => s.device === 'E2E v25.1' || s.device === 'E2E v25.1 header test')
  ok('GET /api/lock/sessions with header → 200', sess.status === 200, `status=${sess.status}`)
  ok('own header-session flagged current:true', !!mine && mine.current === true, JSON.stringify(mine ? { device: mine.device, current: mine.current } : null))

  const wrong = await fetch(`${BASE}/api/lock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ action: 'unlock', pin: 'definitely-not-the-pin-000' }),
  })
  const wrongj = await wrong.json().catch(() => ({}))
  ok('unlock with wrong PIN → 401 Wrong PIN', wrong.status === 401 && /wrong/i.test(wrongj.error || ''), `${wrong.status}`)

  // 8. logout via the header channel kills the session row (embedded clients can lock too)
  const lo = await fetch(`${BASE}/api/lock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
    body: JSON.stringify({ action: 'logout' }),
  })
  const loj = await lo.json()
  const rowGone = !(await db.lockSession.findUnique({ where: { tokenHash } }))
  ok('logout with header token → ok + registry row deleted', lo.ok && loj.ok && rowGone, `ok=${loj.ok} rowGone=${rowGone}`)

  // 9. lock screen HTML is public and served with the layout bridge mounted
  //    (auto-resume strings live in the client JS chunk, not in SSR HTML —
  //    the initial server render shows the "Checking lock…" state instead)
  const lockPage = await fetch(`${BASE}/lock?next=%2F`)
  const lockHtml = await lockPage.text()
  ok('GET /lock → 200 public', lockPage.status === 200, `status=${lockPage.status}`)
  ok('lock page serves bridge + initial state', lockHtml.includes('data-ca-token-bridge') && lockHtml.includes('Checking lock'), '')

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  process.exitCode = fail ? 1 : 0
}

main()
  .catch(e => { console.error('E2E crashed:', e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
