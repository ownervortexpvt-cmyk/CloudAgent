/**
 * save-payment-config.js — v161
 * 1) Saves Razorpay keys into UserSetting (encrypted with the SAME scheme as
 *    src/lib/crypto.ts — AES-256-GCM, dev fallback secret since CLOUD_AGENT_SECRET
 *    is not set in .env, so the running server decrypts them correctly).
 * 2) Resets the owner password (mdhonabali61@gmail.com → Owner123).
 * Idempotent — safe to run again.
 */
const crypto = require('crypto')
const { PrismaClient } = require('@prisma/client')

const DEV_SECRET = process.env.CLOUD_AGENT_SECRET && process.env.CLOUD_AGENT_SECRET.length >= 16
  ? process.env.CLOUD_AGENT_SECRET
  : 'cloud-agent-dev-key-v1'

function getKey() {
  return crypto.scryptSync(DEV_SECRET, 'cloud-agent-salt', 32)
}
function encrypt(plaintext) {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const RZP_KEY_ID = 'rzp_test_Tx6AcbO4VPm4xj'
const RZP_KEY_SECRET = 'MUhTtKeOXRuxTktn78fBfg31'
const OWNER_EMAIL = 'mdhonabali61@gmail.com'
const OWNER_PW = 'Owner123'

const prisma = new PrismaClient()

async function upsert(key, value) {
  await prisma.userSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

async function main() {
  await upsert('razorpay_key_id', encrypt(RZP_KEY_ID))
  await upsert('razorpay_key_secret', encrypt(RZP_KEY_SECRET))
  console.log('[ok] razorpay keys saved (encrypted at rest)')

  const owner = await prisma.authUser.findUnique({ where: { email: OWNER_EMAIL } })
  if (!owner) {
    console.log('[warn] owner user not found:', OWNER_EMAIL)
  } else {
    await prisma.authUser.update({
      where: { email: OWNER_EMAIL },
      data: { passwordHash: hashPassword(OWNER_PW), status: 'active' },
    })
    console.log('[ok] owner password reset →', OWNER_EMAIL, '= Owner123')
  }

  // verify round-trip with the SAME decrypt the server uses
  const rows = await prisma.userSetting.findMany({ where: { key: { in: ['razorpay_key_id', 'razorpay_key_secret'] } } })
  for (const r of rows) {
    const parts = r.value.split(':')
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(parts[1], 'base64'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
    const dec = Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
    console.log('[verify]', r.key, '→', dec.slice(0, 10) + '…')
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
