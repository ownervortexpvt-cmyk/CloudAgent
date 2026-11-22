/* v91 E2E — Google Drive removed, everything → Firebase Storage.
 * Run: node scripts/e2e-v91-drive-removed.mjs
 */
import { createHash, createHmac } from 'crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const base = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`) } else { fail++; console.log(`  ✗ ${msg}`) } }

// mint a lock session (same pattern as the platform middleware)
const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'E2E v91', ip: '127.0.0.1' } })
const api = (p, opt = {}) => fetch(base + p, { ...opt, headers: { 'content-type': 'application/json', 'x-ca-lock': TOKEN, ...(opt.headers || {}) } }).catch(() => null)
const j = async (r) => { try { return await r.json() } catch { return null } }

console.log('— 1. Drive routes are GONE —')
let r = await api('/api/gdrive')
ok(r?.status === 404, `GET /api/gdrive → 404 (got ${r?.status})`)
r = await api('/api/sdks/drive')
ok(r?.status === 404, `GET /api/sdks/drive → 404 (got ${r?.status})`)
r = await api('/api/gdrive/callback?code=x&state=y', { redirect: 'manual' })
ok(r?.status === 404, `GET /api/gdrive/callback → 404 (got ${r?.status})`)

console.log('— 2. SDK install refuses Drive sources honestly —')
r = await api('/api/sdks', { method: 'POST', body: JSON.stringify({ name: 'x1', url: 'https://drive.google.com/file/d/1abc12345678/view' }) })
ok(r?.status === 400, `drive.google.com share link → 400 (got ${r?.status})`)
ok(((await j(r))?.error || '').includes('no longer accepted'), 'share-link rejection message honest')
r = await api('/api/sdks', { method: 'POST', body: JSON.stringify({ name: 'x2', url: 'https://drive.usercontent.google.com/download?id=abc12345678' }) })
ok(r?.status === 400, `usercontent direct link → 400 (got ${r?.status})`)
r = await api('/api/sdks', { method: 'POST', body: JSON.stringify({ name: 'x3', driveFileId: '1abc12345678' }) })
ok(r?.status === 400, `bare driveFileId (no source) → 400 (got ${r?.status})`)

console.log('— 3. source export → cloud vault only —')
r = await api('/api/source-export', { method: 'POST', body: JSON.stringify({ action: 'to-drive' }) })
ok(r?.status === 400, `to-drive action removed → 400 (got ${r?.status})`)
r = await api('/api/source-export', { method: 'POST', body: JSON.stringify({ action: 'to-firebase' }) })
// v95 baseline-aware: when NO vault is connected (owner moved to R2 / cleared
// Firebase), the honest 400 names BOTH options; when a vault IS connected,
// the upload attempt ends 502 (bucket 404 until Storage activated) or 200.
const ex = await j(r)
const anyVault = ex && /vault is (not )?connected/i.test(ex.error || '') ? false : true
ok(r?.status === 400 || r?.status === 502 || r?.status === 200, `to-firebase honest (got ${r?.status}: ${(ex?.error || ex?.object || '').slice(0, 60)})`)
ok(!!(ex?.error || ex?.object), 'carries error note or success object name')
if (!anyVault) ok(r?.status === 400 && /R2/.test(ex.error || ''), 'no-vault honest 400 recommends R2 (v95 behavior)')

console.log('— 4. vault state — baseline-aware (v95: owner may disconnect Firebase and use R2) —')
r = await api('/api/firebase')
const st = await j(r)
if (st?.connected) {
  ok(st?.enabled === true && st?.auto === true, `enabled:${st?.enabled} auto:${st?.auto}`)
  ok(/does not exist yet/.test(st?.error || ''), 'status still carries the honest Storage-activation guidance')
} else {
  ok(st?.connected === false && !!st?.error === false, 'vault honestly reports disconnected (owner state — preserved, not a regression)')
}

console.log('— 5. no Drive leftovers in DB —')
const rows = await db.userSetting.findMany({ where: { key: { startsWith: 'gdrive.' } } })
ok(rows.length === 0, `gdrive.* settings purged (${rows.length} left)`)

console.log('— cleanup —')
await db.lockSession.deleteMany({ where: { tokenHash: createHash('sha256').update(TOKEN).digest('hex') } })
await db.$disconnect()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
