/* v89.1 E2E — REAL Firebase key activation (owner's own service account).
 * Reads the SA JSON from data/fb-sa.json (gitignored, NEVER committed).
 * No source changes — this proves the v89 vault chain against real Google.
 * Run: node scripts/e2e-v90-real-vault.mjs
 */
import { createHash, createHmac } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const BASE = 'http://localhost:3000'
const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ FAIL: ${label}`) } }

let lockHeaderVal = ''
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-ca-lock': lockHeaderVal, ...(opts.headers || {}) },
    redirect: 'manual',
  })
  return res
}
async function j(res) { try { return await res.json() } catch { return {} } }

async function main() {
  console.log('— 0. load owner SA key (gitignored file) —')
  const saRaw = readFileSync('/home/z/my-project/data/fb-sa.json', 'utf8')
  const sa = JSON.parse(saRaw)
  ok(sa.client_email?.endsWith('@cloud-agent-19b5f.iam.gserviceaccount.com'), `SA client_email = ${sa.client_email}`)
  ok(sa.private_key.includes('PRIVATE KEY'), 'SA private_key PEM present')

  console.log('— 1. lock session mint —')
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'E2E v89.1 real vault', ip: '127.0.0.1' } })
  lockHeaderVal = TOKEN
  ok((await api('/api/lock')).status === 200, 'locked API reachable')

  console.log('— 2. current vault status —')
  let r = await api('/api/firebase'); let d = await j(r)
  ok(r.status === 200, `GET status → bucket=${d.bucket || '∅'} connected=${d.connected}`)
  if (!d.bucket) {
    // safety net: re-save the owner's public firebaseConfig (no secrets in it)
    r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'save-config', config: JSON.stringify({
      apiKey: 'AIzaSyAhQoFj6WCacnd0u3JQwGyBb1-vcRS_p2o',
      authDomain: 'cloud-agent-19b5f.firebaseapp.com',
      projectId: 'cloud-agent-19b5f',
      storageBucket: 'cloud-agent-19b5f.firebasestorage.app',
      messagingSenderId: '196934245112',
      appId: '1:196934245112:web:4d6980fee1a782b3a3f90d',
      measurementId: 'G-6NWPHZC1GW',
    }) }) })
    d = await j(r)
    ok(r.status === 200 && d.bucket === 'cloud-agent-19b5f.firebasestorage.app', `config saved → bucket=${d.bucket}`)
  } else {
    ok(d.bucket === 'cloud-agent-19b5f.firebasestorage.app', `bucket already configured = ${d.bucket}`)
  }

  console.log('— 3. save REAL service account → deep verify against Google —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'save-service-account', json: saRaw }) })
  d = await j(r)
  ok(r.status === 200 && d.saved === true, `saved (email=${d.serviceAccountEmail || '?'})`)
  if (d.verified) {
    ok(true, `VERIFIED against real Google — bucket location: ${d.location || 'n/a'}`)
  } else {
    ok(false, `verify FAILED honestly: ${d.warning}`)
  }

  console.log('— 4. REAL backup-now → owner Firebase Storage —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'backup-now' }) })
  d = await j(r)
  ok(r.status === 200 && d.ok === true, `backup uploaded: ${d.object} (${d.sizeKb} KB in ${d.durationMs} ms)`)
  ok(d.counts && typeof d.counts.projects === 'number', `counts: ${JSON.stringify(d.counts)}`)
  const firstObject = d.object
  const firstSizeKb = d.sizeKb

  console.log('— 5. list restore points (read-back from Google) —')
  r = await api('/api/firebase'); d = await j(r)
  ok(r.status === 200 && Array.isArray(d.backups) && d.backups.length >= 1, `restore points listed: ${d.backups.length}`)
  const listed = d.backups.find(b => b.name === firstObject)
  ok(!!listed, `first object visible in list: ${firstObject}`)
  ok(listed && Math.abs(listed.sizeKb - firstSizeKb) <= 1, `size matches (${listed?.sizeKb} KB ≈ ${firstSizeKb} KB)`)
  ok(d.vaultUsedKb >= firstSizeKb, `vault usage ${d.vaultUsedKb} KB`)
  ok(d.lastBackupAt, `lastBackupAt = ${d.lastBackupAt}`)

  console.log('— 6. Firebase master switch round-trip (owner toggle) —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'set-enabled', enabled: false }) })
  d = await j(r)
  ok(r.status === 200 && d.enabled === false, 'switch OFF accepted')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'backup-now' }) })
  ok(r.status === 409, `backup-now while OFF → 409 (honest guard)`)
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'set-enabled', enabled: true }) })
  d = await j(r)
  ok(r.status === 200 && d.enabled === true, 'switch back ON')

  console.log('— 7. daily auto-backup ON (the real phone-loss protection) —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'set-auto', auto: true }) })
  d = await j(r)
  ok(r.status === 200 && d.auto === true, 'auto daily backup enabled')

  console.log('— 8. final status snapshot —')
  r = await api('/api/firebase'); d = await j(r)
  ok(d.connected === true && d.enabled === true && d.auto === true, `connected=${d.connected} enabled=${d.enabled} auto=${d.auto}`)
  ok(d.error === null, `no Google-side errors (error=${d.error})`)
  console.log(`  → restore points: ${d.backups.length}, vault used: ${d.vaultUsedKb} KB, disk free: ${d.localDiskFreeMb} MB`)

  console.log(`\n${pass} passed, ${fail} failed`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
