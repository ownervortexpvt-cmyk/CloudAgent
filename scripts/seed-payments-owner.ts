/**
 * Seed Razorpay keys (encrypted, same AES-256-GCM scheme as src/lib/crypto)
 * + reset the owner password to Owner123 (scrypt salt:hash, src/lib/auth).
 * Runs against db/custom.db DIRECTLY (bun:sqlite) — no app restart needed,
 * so logged-in users are never disturbed (45s cache self-invalidates via
 * the DB mtime stamp).
 *
 * CLOUD_AGENT_SECRET is intentionally NOT set here — the server's .env has
 * no such var either, so both sides use the identical deterministic dev key.
 */
import { Database } from 'bun:sqlite'
import crypto from 'crypto'

const DB_PATH = '/home/z/my-project/db/custom.db'

/* ── mirrors src/lib/crypto.ts ── */
function getKey(): Buffer {
  const secret = process.env.CLOUD_AGENT_SECRET && process.env.CLOUD_AGENT_SECRET.length >= 16
    ? process.env.CLOUD_AGENT_SECRET
    : 'cloud-agent-dev-key-v1'
  return crypto.scryptSync(secret, 'cloud-agent-salt', 32)
}
function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}
function decrypt(ciphertext: string): string {
  try {
    const parts = ciphertext.split(':')
    if (parts.length !== 4 || parts[0] !== 'v1') return ''
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const enc = Buffer.from(parts[3], 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

/* ── mirrors src/lib/auth.ts hashPassword ── */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')

// UserSetting columns: id, key, value (schema.prisma L145 — no timestamps)
const upsert = (key: string, value: string) => {
  db.query(
    `INSERT INTO UserSetting (id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(crypto.randomUUID(), key, value)
}

/* 1 — Razorpay keys (test mode, from the owner's dashboard) */
upsert('razorpay_key_id', encrypt('rzp_test_Tx6AcbO4VPm4xj'))
upsert('razorpay_key_secret', encrypt('MUhTtKeOXRuxTktn78fBfg31'))

/* 2 — owner password reset */
// AuthUser password column is passwordHash (schema.prisma L558)
const pw = hashPassword('Owner123')
const u = db.query(`SELECT id, email FROM AuthUser WHERE email = ?`).get('mdhonabali61@gmail.com') as any
if (!u) {
  console.error('OWNER_NOT_FOUND')
  process.exit(1)
}
db.query(`UPDATE AuthUser SET passwordHash = ? WHERE id = ?`).run(pw, u.id)

/* 3 — verify round-trip */
const rows = db.query(`SELECT key, value FROM UserSetting WHERE key LIKE 'razorpay%'`).all() as any[]
for (const r of rows) {
  const plain = decrypt(r.value)
  console.log(`${r.key}: ${plain ? 'DECRYPT_OK (' + plain.slice(0, 12) + '...)' : 'DECRYPT_FAIL'}`)
}
const chk = db.query(`SELECT passwordHash FROM AuthUser WHERE id = ?`).get(u.id) as any
const [salt, hash] = String(chk.passwordHash).split(':')
const ok = crypto.scryptSync('Owner123', salt, 64).toString('hex') === hash
console.log(`owner ${u.email}: password-verify ${ok ? 'OK' : 'FAIL'}`)
db.close()
console.log('SEED_DONE')
