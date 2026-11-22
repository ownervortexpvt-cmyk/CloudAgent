// v105 E2E: Settings → "Download project ZIP" native-download flow.
// 1. ?mint=1 without auth          → 401
// 2. ?mint=1 WITH lock header      → 200 {ok, token}  (fresh 24h token)
// 3. GET /api/backup-download?token=<minted> → 200 zip, correct size, PK header
// 4. integrity: unzip -t on the downloaded file
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ FAIL: ${name}`) } }

// ── mint a lock session (same pattern as v102 tests) ─────────────────────────
const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const secret = secretRow?.value
const expiry = Date.now() + 60_000
const sig = crypto.createHmac('sha256', secret).update(`v1.${expiry}`).digest('hex')
const lockToken = `v1.${expiry}.${sig}`
const tokenHash = crypto.createHash('sha256').update(lockToken).digest('hex')
await db.lockSession.upsert({
  where: { tokenHash },
  update: { lastSeenAt: new Date() },
  create: { tokenHash, device: 'e2e-v105', ip: '127.0.0.1', lastSeenAt: new Date() },
})
const H = { 'x-ca-lock': lockToken }

// ── 1. mint without auth → 401 ────────────────────────────────────────────────
const r1 = await fetch(`${BASE}/api/backup-download?mint=1`)
ok(r1.status === 401, `mint without auth → 401 (got ${r1.status})`)

// ── 2. mint with lock header → fresh token ───────────────────────────────────
const r2 = await fetch(`${BASE}/api/backup-download?mint=1`, { headers: H })
const j2 = await r2.json().catch(() => null)
ok(r2.status === 200 && j2?.ok === true && /^[a-f0-9]{48}$/.test(j2?.token || ''), `mint with lock header → 200 + 48-hex token (got ${r2.status})`)

// old token must be replaced (single-active token policy)
const stored = JSON.parse((await db.userSetting.findUnique({ where: { key: 'zip_download_token' } }))?.value || '{}')
ok(stored.token === j2.token, 'minted token stored in zip_download_token')

// ── 3. download with the minted token (route builds the zip on demand) ───────
const out = '.e2e-v105-dl.zip'
const t0 = Date.now()
execSync(`curl -s -o ${out} -w "%{http_code} %{size_download}" --max-time 240 "${BASE}/api/backup-download?token=${j2.token}" > .e2e-v105-meta.txt`)
const [code, size] = fs.readFileSync('.e2e-v105-meta.txt', 'utf8').trim().split(' ')
ok(code === '200', `download with minted token → 200 (got ${code}, took ${((Date.now() - t0) / 1000).toFixed(0)}s incl. lazy build)`)
const zips = fs.readdirSync('download').filter(f => /^cloud-agent-full-backup-\d{8}\.zip$/.test(f))
ok(zips.length > 0, `on-demand zip exists in download/ (${zips.join(', ') || 'NONE'})`)
const stat = fs.statSync(`download/${zips[0]}`)
ok(Number(size) === stat.size, `size matches on-disk zip (${size} vs ${stat.size})`)
const head = fs.readFileSync(out).subarray(0, 2).toString()
ok(head === 'PK', `file header is PK (zip magic, got "${head}")`)

// ── 4. integrity ─────────────────────────────────────────────────────────────
const t = execSync(`unzip -t ${out} 2>&1 | tail -1`).toString().trim()
ok(t.includes('No errors'), `unzip -t clean (${t})`)

// wrong token still fails
const r3 = await fetch(`${BASE}/api/backup-download?token=${'a'.repeat(48)}`)
ok(r3.status === 401, `wrong token → 401 fail-closed (got ${r3.status})`)

fs.unlinkSync(out); fs.unlinkSync('.e2e-v105-meta.txt')
console.log(`\nRESULT: ${pass}/${pass + fail} passed`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
