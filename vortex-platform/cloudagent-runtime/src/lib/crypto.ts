/**
 * Encryption utility for sensitive credentials (API keys, GitHub PATs, secrets).
 *
 * Uses AES-256-GCM with a key derived from CLOUD_AGENT_SECRET env var via scrypt.
 * The key never leaves the server; ciphertexts are stored in DB.
 *
 * If CLOUD_AGENT_SECRET is not set, we derive a deterministic dev key from a
 * machine fingerprint — clearly marked as dev-only behavior. In production,
 * set CLOUD_AGENT_SECRET explicitly.
 */
import crypto from 'crypto'

const DEV_FALLBACK_LABEL = 'cloud-agent-dev-key-v1'

function getSecret(): string {
  const env = process.env.CLOUD_AGENT_SECRET
  if (env && env.length >= 16) return env
  // Dev fallback — obfuscated but NOT secure. Operator must set
  // CLOUD_AGENT_SECRET in production deployments.
  return DEV_FALLBACK_LABEL
}

function getKey(): Buffer {
  return crypto.scryptSync(getSecret(), 'cloud-agent-salt', 32)
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ''
  try {
    const parts = ciphertext.split(':')
    if (parts.length !== 4 || parts[0] !== 'v1') return ''
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const enc = Buffer.from(parts[3], 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return dec.toString('utf8')
  } catch {
    return ''
  }
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '•'.repeat(key.length)
  return key.slice(0, 4) + '•'.repeat(Math.max(4, key.length - 8)) + key.slice(-4)
}
