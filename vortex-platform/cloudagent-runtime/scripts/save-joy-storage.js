/**
 * save-joy-storage.js — v161: connect the JOY SERVICE S3 vault (idempotent).
 * Values are the owner-provided keys + the endpoint/bucket proven in the
 * earlier joy-public-put / joy-e2e-test rounds (worklog Task 156b, 8/8 pass).
 * After saving, performs a REAL SigV4 ListObjectsV2 to prove auth works.
 */
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')

const DEV_SECRET = process.env.CLOUD_AGENT_SECRET && process.env.CLOUD_AGENT_SECRET.length >= 16
  ? process.env.CLOUD_AGENT_SECRET
  : 'cloud-agent-dev-key-v1'
const getKey = () => crypto.scryptSync(DEV_SECRET, 'cloud-agent-salt', 32)
function encrypt(plaintext) {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

const JOY = {
  accessKeyId: (SECRETS.joyAccessKey || ''),
  secretAccessKey: (SECRETS.joySecretKey || ''),
  endpoint: 'https://nz.in.s3.joy.services',
  bucket: 'vortex-websites',
  label: 'JOY SERVICE',
}

const prisma = new PrismaClient()
async function up(key, value) {
  await prisma.userSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/* ─── SigV4 (proven scheme: sorted headers + real payload hash, region default) ─── */
function hmac(k, d) { return crypto.createHmac('sha256', k).update(d).digest() }
function sha256hex(b) { return crypto.createHash('sha256').update(b).digest('hex') }

function sigv4Get(endpoint, bucket, accessKey, secretKey) {
  const url = new URL(endpoint)
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const query = 'list-type=2&max-keys=1'
  const payload = sha256hex('')
  const headers = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate }
  const sorted = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]).sort(([a], [b]) => (a < b ? -1 : 1))
  const ch = sorted.map(([k, v]) => `${k}:${v}\n`).join('')
  const sh = sorted.map(([k]) => k).join(';')
  const cr = ['GET', `/${bucket}`, query, ch, sh, payload].join('\n')
  const scope = `${date}/default/s3/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(cr)].join('\n')
  const kD = hmac(`AWS4${secretKey}`, date), kR = hmac(kD, 'default'), kS = hmac(kR, 's3'), kSig = hmac(kS, 'aws4_request')
  const sig = crypto.createHmac('sha256', kSig).update(sts).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${sh}, Signature=${sig}`
  return fetch(`${endpoint}/${bucket}?${query}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  })
}

async function main() {
  await up('r2store.accessKeyId', JOY.accessKeyId)
  await up('r2store.secretEnc', encrypt(JOY.secretAccessKey))
  await up('r2store.endpoint', JOY.endpoint)
  await up('r2store.bucket', JOY.bucket)
  await up('r2store.region', 'default')
  await up('r2store.enabled', '1')
  await up('r2store.label', JOY.label)
  console.log('[ok] JOY SERVICE vault settings saved (endpoint + bucket + keys)')

  console.log('[..] verifying with real ListObjectsV2 …')
  const res = await sigv4Get(JOY.endpoint, JOY.bucket, JOY.accessKeyId, JOY.secretAccessKey)
  const txt = await res.text().catch(() => '')
  if (res.ok) {
    console.log('[ok] VERIFY 200 — bucket reachable, keys accepted')
    console.log(txt.split('\n').slice(0, 6).join('\n'))
  } else {
    console.log(`[FAIL] VERIFY ${res.status}:`, txt.slice(0, 300))
    process.exitCode = 2
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
