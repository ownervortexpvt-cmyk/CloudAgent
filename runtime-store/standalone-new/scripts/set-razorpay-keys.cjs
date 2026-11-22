#!/usr/bin/env node
/** Store Razorpay keys (encrypted, app's own AES-256-GCM scheme) in UserSetting. */
const crypto = require('crypto')
const fs = require('fs')
const { PrismaClient } = require('@prisma/client')

// mirror src/lib/crypto.ts — CLOUD_AGENT_SECRET env, dev fallback label
function getSecret() {
  let env = process.env.CLOUD_AGENT_SECRET
  if (!env) {
    // .env is not auto-loaded by plain node — parse it
    try {
      const txt = fs.readFileSync('/home/z/my-project/.env', 'utf8')
      const m = txt.match(/^CLOUD_AGENT_SECRET=(.*)$/m)
      if (m) env = m[1].trim().replace(/^["']|["']$/g, '')
    } catch {}
  }
  if (env && env.length >= 16) return env
  return 'cloud-agent-dev-key-v1'
}
function getKey() { return crypto.scryptSync(getSecret(), 'cloud-agent-salt', 32) }
function encrypt(plaintext) {
  if (!plaintext) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

const db = new PrismaClient()
const ROWS = {
  razorpay_key_id: process.argv[2] || 'rzp_test_Tx6AcbO4VPm4xj',
  razorpay_key_secret: process.argv[3] || 'MUhTtKeOXRuxTktn78fBfg31',
}

async function main() {
  for (const [key, plain] of Object.entries(ROWS)) {
    const value = encrypt(plain)
    await db.userSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    console.log(`${key}: stored (enc ${value.length} chars)`)
  }
}
main().finally(() => db.$disconnect())
