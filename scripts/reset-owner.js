/**
 * One-shot maintenance script (run manually via node):
 *  1. Reset the owner account password (mdhonabali61@gmail.com → Owner123).
 *     Hash format matches src/lib/auth.ts: scrypt hex, `${salt}:${hash}`, 64-byte key.
 *  2. Verify the Razorpay keys saved in DB actually decrypt with the app's
 *     crypto (AES-256-GCM, scrypt key from CLOUD_AGENT_SECRET or dev fallback).
 *  Safe to re-run: upsert semantics, no data loss.
 */
const path = require('path')
const crypto = require('crypto')
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:/home/z/my-project/db/custom.db'

const { PrismaClient } = require(path.join('/home/z/my-project', 'node_modules', '@prisma/client'))
const prisma = new PrismaClient()

// replica of src/lib/crypto.ts getKey()
function getKey() {
  const secret = process.env.CLOUD_AGENT_SECRET && process.env.CLOUD_AGENT_SECRET.length >= 16
    ? process.env.CLOUD_AGENT_SECRET
    : 'cloud-agent-dev-key-v1'
  return crypto.scryptSync(secret, 'cloud-agent-salt', 32)
}
function decrypt(ciphertext) {
  if (!ciphertext) return ''
  try {
    const parts = ciphertext.split(':')
    if (parts.length !== 4 || parts[0] !== 'v1') return ''
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const enc = Buffer.from(parts[3], 'base64')
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  } catch {
    return ''
  }
}

const OWNER_EMAIL = 'mdhonabali61@gmail.com'
const NEW_PASSWORD = 'Owner123'

async function main() {
  // 1. owner password reset
  const user = await prisma.authUser.findUnique({ where: { email: OWNER_EMAIL } })
  if (!user) {
    console.log('owner-missing: no authUser with email', OWNER_EMAIL)
  } else {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.scryptSync(NEW_PASSWORD, salt, 64).toString('hex')
    await prisma.authUser.update({ where: { id: user.id }, data: { passwordHash: `${salt}:${hash}`, status: 'active' } })
    console.log(`owner-reset: ${user.email} role=${user.role} password→Owner123 ✔`)
  }

  // 2. sanity: what payment keys exist in KV?
  const rows = await prisma.userSetting.findMany({
    where: { key: { in: ['razorpay_key_id', 'razorpay_key_secret', 'admin_lock_hash'] } },
  })
  for (const r of rows) {
    if (r.key === 'razorpay_key_id') {
      const dec = decrypt(r.value)
      console.log(`kv razorpay_key_id present, decrypt-ok=${dec ? 'yes:' + dec.slice(0, 12) + '…' : 'NO (wrong CLOUD_AGENT_SECRET?)'}`)
    } else if (r.key === 'razorpay_key_secret') {
      console.log(`kv razorpay_key_secret present, decrypt-ok=${decrypt(r.value) ? 'yes' : 'NO'}`)
    } else {
      console.log(`kv ${r.key} present`)
    }
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
