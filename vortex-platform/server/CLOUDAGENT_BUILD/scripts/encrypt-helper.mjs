/**
 * Replicates src/lib/crypto.ts encrypt() for E2E scripts — same AES-256-GCM
 * scheme and the same dev-fallback secret the server uses when
 * CLOUD_AGENT_SECRET is not set (verified unset in this environment).
 */
import crypto from 'crypto'

function getSecret() {
  if (process.env.CLOUD_AGENT_SECRET && process.env.CLOUD_AGENT_SECRET.length >= 16) {
    return process.env.CLOUD_AGENT_SECRET
  }
  return 'cloud-agent-dev-key-v1'
}

function getKey() {
  return crypto.scryptSync(getSecret(), 'cloud-agent-salt', 32)
}

export function encrypt(plaintext) {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}
