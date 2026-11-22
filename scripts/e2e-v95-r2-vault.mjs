// E2E v95 — Cloudflare R2 vault (the owner's budget storage choice)
// A) SigV4 signer verified byte-for-byte against the OFFICIAL AWS docs vector
//    (GET Object example, examplebucket, range=bytes=0-9 → signature
//    f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41)
//    — first the docs pseudocode is reproduced independently, then the
//    shipped src/lib/sigv4.ts is compiled and must produce the SAME header.
// B) /api/r2vault route matrix: lock-guard, save-config parse (garbage /
//    key:value / endpoint-URL / bare-hex), save-keys validation, test with
//    fake creds → honest failure, backup-now without connection → 400,
//    unknown action → 400, disconnect clears all r2store.* rows.
// C) Source wiring: publish route prefers R2 + understands r2: marker;
//    source-export has R2_SOURCE_PREFIX; dialog has the R2 connect UI.
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const db = new PrismaClient()
const base = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  PASS ${label}`) } else { fail++; console.log(`  FAIL ${label}`) } }

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'e2e v95 r2 vault', ip: '127.0.0.1' } })
const H = { 'x-ca-lock': TOKEN, 'Content-Type': 'application/json' }

// ---------- A. SigV4 against the AWS docs vector ----------
console.log('=== 1. SigV4 signer vs official AWS documentation vector ===')

// 1a. independent re-implementation of the AWS pseudocode (docs pseudocode, not the lib)
const AK = 'AKIAIOSFODNN7EXAMPLE'
const SK = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const amzDate = '20130524T000000Z'
const dateStamp = '20130524'
const emptySha = createHash('sha256').update('').digest('hex')
const canonReq = [
  'GET',
  '/test.txt',
  '',
  'host:examplebucket.s3.amazonaws.com\nrange:bytes=0-9\nx-amz-content-sha256:' + emptySha + '\nx-amz-date:' + amzDate + '\n',
  'host;range;x-amz-content-sha256;x-amz-date',
  emptySha,
].join('\n')
const scope = `${dateStamp}/us-east-1/s3/aws4_request`
const sts = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonReq).digest('hex')].join('\n')
const kd = createHmac('sha256', `AWS4${SK}`).update(dateStamp).digest()
const kr = createHmac('sha256', kd).update('us-east-1').digest()
const ks = createHmac('sha256', kr).update('s3').digest()
const ksign = createHmac('sha256', ks).update('aws4_request').digest()
const refSig = createHmac('sha256', ksign).update(sts).digest('hex')
ok(refSig === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  `independent docs re-implementation matches the published signature (${refSig.slice(0, 12)}…)`)

// 1b. compile ONLY the pure sigv4 module and call it with the docs inputs
const outDir = '/home/z/my-project/.zdata/tmp/sigv4-e2e'
fs.mkdirSync(outDir, { recursive: true })
execSync(`npx tsc src/lib/sigv4.ts --outDir ${outDir} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { cwd: '/home/z/my-project' })
const { sigv4Sign } = await import(path.join(outDir, 'sigv4.js'))
const signed = sigv4Sign('GET', '/test.txt', '', 'examplebucket.s3.amazonaws.com', null,
  { accessKeyId: AK, secretAccessKey: SK }, amzDate, 'us-east-1', 's3', { range: 'bytes=0-9' })
ok(signed.authorization === `AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/${scope},SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=${refSig}`,
  'shipped sigv4Sign produces the EXACT documented Authorization header')
ok(signed.payloadHash === emptySha, 'payloadHash = sha256 of empty payload')

// 1c. R2 default region: deterministic + structured (no fixed vector exists for auto; structure checked)
const r2Signed = sigv4Sign('PUT', '/bucket/key.json', '', 'a1b2c3d4.r2.cloudflarestorage.com', Buffer.from('{}'),
  { accessKeyId: AK, secretAccessKey: SK }, '20260914T000000Z')
ok(/Credential=AKIAIOSFODNN7EXAMPLE\/20260914\/auto\/s3\/aws4_request/.test(r2Signed.authorization), 'R2 scope uses region auto + service s3')
ok(/SignedHeaders=host;x-amz-content-sha256;x-amz-date/.test(r2Signed.authorization), 'signed headers sorted correctly')

console.log('=== 2. /api/r2vault route matrix ===')

// lock guard
const noLock = await fetch(`${base}/api/r2vault`)
ok(noLock.status === 401, `GET without lock → 401 (${noLock.status})`)
const noLockPost = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) })
ok(noLockPost.status === 401, `POST without lock → 401 (${noLockPost.status})`)

// clean slate
await db.userSetting.deleteMany({ where: { key: { startsWith: 'r2store.' } } })

// unknown action
const unknown = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'nope' }) }).then(r => r.json())
ok(/unknown action/.test(unknown.error || ''), 'unknown action → honest 400')

// save-config garbage
const bad1 = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save-config', config: 'hello world nothing here' }) })
ok(bad1.status === 400 && /Account ID/.test((await bad1.json()).error), 'save-config garbage → honest Account-ID error')
const bad2 = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save-config', config: 'Account ID: a1b2c3d4e5f60718293a4b5c6d7e8f9a' }) }) // no bucket
ok(bad2.status === 400 && /[Bb]ucket/.test((await bad2.json()).error), 'save-config missing bucket → honest bucket error')

// save-config forms that must WORK
const good1 = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save-config', config: 'Account ID: a1b2c3d4e5f60718293a4b5c6d7e8f9a\nBucket: cloud-agent' }) }).then(r => r.json())
ok(good1.ok === true && good1.accountId === 'a1b2c3d4e5f60718293a4b5c6d7e8f9a' && good1.bucket === 'cloud-agent', 'save-config key:value form works')
const good2 = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save-config', config: 'https://a1b2c3d4e5f60718293a4b5c6d7e8f9a.r2.cloudflarestorage.com my-bucket-2' }) }).then(r => r.json())
ok(good2.ok === true && good2.accountId === 'a1b2c3d4e5f60718293a4b5c6d7e8f9a' && good2.bucket === 'my-bucket-2', 'save-config endpoint-URL form works')

// save-keys validation
const bad3 = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save-keys', keys: 'only-one-value' }) })
ok(bad3.status === 400 && /Both values/.test((await bad3.json()).error), 'save-keys one value → honest error')

// backup-now / restore while not fully connected → honest 400
const bn0 = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'backup-now' }) })
ok(bn0.status === 400, `backup-now without full connection → 400 (${bn0.status})`)

// fake keys save → saved but verified:false (fake creds must NOT pass as real)
const fk = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'save-keys', keys: 'AKIAIOSFODNN7EXAMPLE\nwJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }) }).then(r => r.json())
ok(fk.saved === true && fk.verified === false && fk.warning, 'save-keys with fake creds → saved, honestly NOT verified (real R2 roundtrip attempted)')

// status shape
const st = await fetch(`${base}/api/r2vault`, { headers: H }).then(r => r.json())
ok(st.connected === true && st.bucket === 'my-bucket-2' && typeof st.enabled === 'boolean', 'GET status honest after config+keys')
ok(Array.isArray(st.backups) && st.vaultUsedKb === 0, 'restore-point list present (empty until real keys)')
ok(st.error && (st.error.includes('401') || st.error.includes('403') || st.error.includes('failed') || st.error.includes('denied') || st.error.includes('fetch') || st.error.includes('socket')), `GET surfaces honest connection error (${String(st.error).slice(0, 70)})`)

// set-enabled off/on
const off = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'set-enabled', enabled: false }) }).then(r => r.json())
ok(off.ok === true && off.enabled === false, 'set-enabled OFF works')
const on = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'set-enabled', enabled: true }) }).then(r => r.json())
ok(on.ok === true && on.enabled === true, 'set-enabled ON works')

// secret must be stored ENCRYPTED, never plaintext
const rows = await db.userSetting.findMany({ where: { key: { startsWith: 'r2store.' } } })
ok(rows.some(r => r.key === 'r2store.secretEnc' && !r.value.includes('wJalrXUtnFEMI')), 'secret stored AES-encrypted (plaintext absent from DB row)')
ok(rows.some(r => r.key === 'r2store.accessKeyId' && r.value === 'AKIAIOSFODNN7EXAMPLE'), 'access key id stored (not secret material)')

// disconnect clears everything
const dc = await fetch(`${base}/api/r2vault`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'disconnect' }) }).then(r => r.json())
ok(dc.ok === true, 'disconnect works')
const rowsAfter = await db.userSetting.findMany({ where: { key: { startsWith: 'r2store.' } } })
ok(rowsAfter.length === 0, `disconnect removed all r2store.* rows (left ${rowsAfter.length})`)

console.log('=== 3. source wiring (publish / source-export / UI) ===')
const pubSrc = fs.readFileSync('/home/z/my-project/src/app/api/publish/route.ts', 'utf8')
ok(pubSrc.includes('maybeUploadArtifactToR2'), 'publish route imports the R2 artifact hook')
ok(pubSrc.includes("raw.startsWith('r2:')"), 'publish download fallback understands the r2: marker')
ok(pubSrc.includes('r2st.connected && r2st.enabled'), 'publish vaultSync prefers R2 when connected+ON')
const seSrc = fs.readFileSync('/home/z/my-project/src/app/api/source-export/route.ts', 'utf8')
ok(seSrc.includes('R2_SOURCE_PREFIX') && seSrc.includes('r2UploadObject'), 'source-export can push the archive into R2')
ok(seSrc.includes('vault: \'r2\''), 'source-export response names the vault used')
const dlgSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dialogs/SdkManagerDialog.tsx', 'utf8')
ok(dlgSrc.includes('Cloud Vault — Cloudflare R2'), 'SDK Manager shows the R2 vault card')
ok(dlgSrc.includes("'/api/r2vault'"), 'SDK Manager talks to the R2 vault API')
ok(dlgSrc.includes('Connect R2 vault') && dlgSrc.includes('Manage API tokens'), 'R2 connect UI + phone steps present')

console.log('=== cleanup ===')
fs.rmSync(outDir, { recursive: true, force: true })
await db.lockSession.deleteMany({ where: { device: 'e2e v95 r2 vault' } })
await db.userSetting.deleteMany({ where: { key: { startsWith: 'r2store.' } } })

console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`)
process.exit(fail ? 1 : 0)
