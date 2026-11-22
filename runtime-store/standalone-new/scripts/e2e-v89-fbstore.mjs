/* v89.1 E2E — Firebase Cloud Vault + source export (Drive removed in v91).
 * Real APIs only, full cleanup. Run: node scripts/e2e-v89-fbstore.mjs
 */
import { createHash, createHmac, generateKeyPairSync } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'

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
  console.log('— 1. lock session mint —')
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'E2E v89 fbstore', ip: '127.0.0.1' } })
  lockHeaderVal = TOKEN
  ok((await api('/api/lock')).status === 200, 'locked API reachable with minted session')

  console.log('— 2. /api/firebase honest states (nothing configured yet) —')
  let r = await api('/api/firebase'); let d = await j(r)
  ok(r.status === 200 && d.connected === false, `GET status → connected:false (bucket=${d.bucket || '∅'})`)
  ok(d.enabled === true, 'enabled defaults ON')
  ok(Array.isArray(d.backups) && d.backups.length === 0, 'backups list empty')

  // middleware lock guard: no header → 401
  const anon = await fetch(BASE + '/api/firebase')
  ok(anon.status === 401, 'GET /api/firebase without lock → 401')

  console.log('— 3. save-config: phone-realistic JS snippet (comments, unquoted keys) —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'save-config', config: `// Import the functions you need
const firebaseConfig = {
  apiKey: "AIzaSyAhQoFj6WCacnd0u3JQwGyBb1-vcRS_p2o",
  authDomain: "cloud-agent-19b5f.firebaseapp.com",
  projectId: "cloud-agent-19b5f",
  storageBucket: "cloud-agent-19b5f.firebasestorage.app",
  messagingSenderId: "196934245112",
  appId: "1:196934245112:web:4d6980fee1a782b3a3f90d",
  measurementId: "G-6NWPHZC1GW"
};` }) })
  d = await j(r)
  ok(r.status === 200 && d.ok && d.bucket === 'cloud-agent-19b5f.firebasestorage.app', `save-config parses JS snippet → bucket=${d.bucket}`)
  ok(d.projectId === 'cloud-agent-19b5f', `projectId parsed (${d.projectId})`)

  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'save-config', config: 'hello world no bucket' }) })
  ok(r.status === 400, 'save-config garbage → 400 with honest error')

  console.log('— 4. save-service-account: real-RSA fake key (auth must fail honestly) —')
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const fakeSa = { type: 'service_account', project_id: 'cloud-agent-19b5f', private_key: pem, client_email: 'e2e-test@cloud-agent-19b5f.iam.gserviceaccount.com' }
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'save-service-account', json: JSON.stringify(fakeSa) }) })
  d = await j(r)
  ok(r.status === 200 && d.saved === true, 'SA saved (encrypted at rest)')
  ok(d.verified === false && typeof d.warning === 'string' && d.warning.length > 0, `deep-verify honestly fails: "${String(d.warning).slice(0, 60)}…"`)

  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'save-service-account', json: '{"type":"service_account"}' }) })
  ok(r.status === 400, 'SA missing private_key → 400')

  console.log('— 5. toggles + guarded actions —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'set-enabled', enabled: false }) })
  d = await j(r)
  ok(r.status === 200 && d.enabled === false, 'set-enabled:false stored')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'backup-now' }) })
  ok(r.status === 409, `backup-now while OFF → 409 honest (got ${r.status})`)
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'set-enabled', enabled: true }) })
  ok((await j(r)).enabled === true, 'set-enabled:true stored')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'set-auto', auto: true }) })
  ok((await j(r)).auto === true, 'set-auto:true stored')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'backup-now' }) })
  ok(r.status === 502 || r.status === 400, `backup-now with fake key → honest ${r.status} error (never a silent hang)`)

  console.log('— 6. /api/backup regression (payload core refactor) —')
  r = await api('/api/backup'); d = await j(r)
  ok(r.status === 200 && d.backup?.kind === 'cloud-agent-backup', `GET /api/backup ok (${d.backup?.counts?.projects} projects, ${d.backup?.counts?.files} files)`)
  const safe = JSON.stringify(d.backup)
  ok(!safe.includes('"lock_secret"') && !safe.includes('lock_hash'), 'backup excludes security settings')
  ok(!safe.includes('apiKeyEnc'), 'backup strips provider API keys')
  r = await api('/api/backup', { method: 'POST', body: JSON.stringify({ backup: d.backup }) })
  d = await j(r)
  ok(r.status === 200 && d.ok && typeof d.stats?.projectsUpdated === 'number', `additive restore round-trip ok (${d.durationMs}ms)`)

  console.log('— 7. source export: stream + archive sanity —')
  r = await api('/api/source-export')
  ok(r.status === 200 && (r.headers.get('content-type') || '').includes('gzip'), 'GET source-export streams gzip')
  const ab = Buffer.from(await r.arrayBuffer())
  ok(ab.length > 100 * 1024, `archive size sane: ${(ab.length / 1024).toFixed(0)} KB`)
  const tmp = '/home/z/my-project/.zdata/tmp/e2e-source-check.tar.gz'
  execSync(`mkdir -p /home/z/my-project/.zdata/tmp`)
  writeFileSync(tmp, ab)
  const listing = execSync(`tar -tzf ${tmp}`).toString()
  ok(listing.includes('src/lib/fbstore.ts'), 'archive contains platform source (fbstore.ts)')
  ok(listing.includes('package.json') && listing.includes('prisma/schema.prisma'), 'archive contains configs + prisma schema')
  ok(listing.includes('.env'), 'archive contains .env (owner keeps it private)')
  ok(!listing.includes('node_modules') && !listing.includes('custom.db') && !listing.includes('./sdk/'), 'archive excludes node_modules/db/sdk')
  execSync(`rm -f ${tmp}`)

  r = await api('/api/source-export', { method: 'POST', body: JSON.stringify({ action: 'to-drive' }) })
  ok(r.status === 400, `to-drive removed in v91 → 400 unknown action (got ${r.status})`)

  console.log('— 8. Drive removed (v91) —')
  r = await api('/api/gdrive')
  ok(r.status === 404, `GET /api/gdrive → 404 (route deleted, got ${r.status})`)
  r = await api('/api/sdks/drive')
  ok(r.status === 404, `GET /api/sdks/drive → 404 (route deleted, got ${r.status})`)
  r = await api('/api/sdks', { method: 'POST', body: JSON.stringify({ name: 'test-sdk', url: 'https://drive.google.com/file/d/1abc1234567/view' }) })
  ok(r.status === 400, `SDK install via Drive link → 400 honest rejection (got ${r.status})`)
  const driveErr = (await j(r)).error || ''
  ok(driveErr.includes('no longer accepted'), `rejection message honest: "${driveErr.slice(0, 80)}…"`)

  console.log('— 9. cleanup: disconnect vault + remove settings —')
  r = await api('/api/firebase', { method: 'POST', body: JSON.stringify({ action: 'disconnect' }) })
  ok((await j(r)).ok === true, 'disconnect ok')
  d = await j(await api('/api/firebase'))
  ok(d.connected === false && d.bucket === '', 'vault fully cleared after disconnect')
  const left = await db.userSetting.findMany({ where: { key: { startsWith: 'fbstore.' } } })
  ok(left.length === 0, `no fbstore.* rows left (${left.length})`)

  console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(1) }).finally(() => db.$disconnect())
