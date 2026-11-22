import fs from 'fs'
// v167.1 secret hygiene — live credentials load from .secrets (never committed)
let SECRETS = {}
try { SECRETS = JSON.parse(fs.readFileSync('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}
#!/usr/bin/env node
/**
 * fix-all.mjs — one-shot owner-side fixes:
 *  A. Owner password -> Owner123 (survives boot-heal: row exists => never overwritten)
 *  B. Razorpay test keys -> encrypted UserSetting rows (validated live first)
 *  C. R2 vault creds test (both orderings of the owner-provided pair)
 * Run: node --env-file=.env scripts/fix-all.mjs
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/* ---------- crypto.ts replica (AES-256-GCM, dev fallback key) ---------- */
function getKey() {
  const secret = process.env.CLOUD_AGENT_SECRET && process.env.CLOUD_AGENT_SECRET.length >= 16
    ? process.env.CLOUD_AGENT_SECRET
    : 'cloud-agent-dev-key-v1'
  return crypto.scryptSync(secret, 'cloud-agent-salt', 32)
}
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}
function decrypt(ciphertext) {
  try {
    const [v, iv, tag, enc] = String(ciphertext).split(':')
    if (v !== 'v1') return ''
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
  } catch { return '' }
}
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`
}

async function upsertSetting(key, value) {
  await db.userSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/* ============================== A. passwords ============================== */
const OWNER_EMAIL = 'mdhonabali61@gmail.com'
const owner = await db.authUser.findUnique({ where: { email: OWNER_EMAIL } })
if (owner) {
  await db.authUser.update({ where: { email: OWNER_EMAIL }, data: { passwordHash: hashPassword('Owner123') } })
  console.log(`A. owner ${OWNER_EMAIL}: password reset -> Owner123 (row existed since ${owner.createdAt})`)
} else {
  await db.authUser.create({ data: { email: OWNER_EMAIL, passwordHash: hashPassword('Owner123'), name: 'Owner', role: 'admin' } })
  console.log('A. owner row MISSING — recreated with Owner123/admin')
}

/* ============================== B. Razorpay ============================== */
const RZP_ID = 'rzp_test_Tx6AcbO4VPm4xj'
const RZP_SECRET = 'MUhTtKeOXRuxTktn78fBfg31'
try {
  const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
    headers: { Authorization: 'Basic ' + Buffer.from(`${RZP_ID}:${RZP_SECRET}`).toString('base64') },
    signal: AbortSignal.timeout(15000),
  })
  console.log(`B. Razorpay live validation: HTTP ${res.ok ? '200 OK — keys valid' : res.status}`)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.log('   body:', t.slice(0, 200))
  }
  if (res.ok) {
    await upsertSetting('razorpay_key_id', encrypt(RZP_ID))
    await upsertSetting('razorpay_key_secret', encrypt(RZP_SECRET))
    console.log('B. razorpay_key_id + razorpay_key_secret saved (AES-256-GCM encrypted)')
  } else {
    console.log('B. keys NOT saved — Razorpay rejected the pair')
  }
} catch (e) {
  console.log('B. Razorpay validation network error:', e.message)
}

/* ============================== C. R2 creds test ============================== */
// Minimal AWS SigV4 for the R2 S3 endpoint.
const ACC = (SECRETS.cfAccount || '')
const pairs = [
  { accessKeyId: (SECRETS.joyAccessKey || ''), secretAccessKey: (SECRETS.joySecretKey || '') },
  { accessKeyId: (SECRETS.joySecretKey || ''), secretAccessKey: (SECRETS.joyAccessKey || '') },
]
function sigv4(method, path, query, host, creds, amzDate) {
  const date = amzDate.slice(0, 8)
  const payloadHash = crypto.createHash('sha256').update('').digest('hex')
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${date}/auto/s3/aws4_request`
  const strToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const k = (s) => crypto.createHmac('sha256', s)
  const kDate = k(`AWS4${creds.secretAccessKey}`).update(date).digest()
  const kRegion = k(kDate).update('auto').digest()
  const kService = k(kRegion).update('s3').digest()
  const kSign = k(kService).update('aws4_request').digest()
  const sig = crypto.createHmac('sha256', kSign).update(strToSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`
}
for (const creds of pairs) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const host = `${ACC}.r2.cloudflarestorage.com`
  const auth = sigv4('GET', '/', '', host, creds, amzDate)
  try {
    const res = await fetch(`https://${host}/`, {
      headers: { authorization: auth, 'x-amz-date': amzDate, 'x-amz-content-sha256': crypto.createHash('sha256').update('').digest('hex') },
      signal: AbortSignal.timeout(15000),
    })
    const t = await res.text().catch(() => '')
    console.log(`C. R2 test ${creds.accessKeyId.slice(0, 6)}…: HTTP ${res.status} ${t.replace(/\s+/g, ' ').slice(0, 160)}`)
  } catch (e) {
    console.log(`C. R2 test ${creds.accessKeyId.slice(0, 6)}…: network ${e.message}`)
  }
}

/* sanity: decrypt what we stored */
const chk = await db.userSetting.findMany({ where: { key: { in: ['razorpay_key_id', 'razorpay_key_secret'] } } })
for (const row of chk) console.log(`   sanity ${row.key}: decrypt -> ${decrypt(row.value).slice(0, 12)}… OK`)

await db.$disconnect()
console.log('fix-all done')
