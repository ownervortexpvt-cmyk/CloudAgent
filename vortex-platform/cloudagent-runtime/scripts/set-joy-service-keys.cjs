#!/usr/bin/env node
/** Store JOY SERVICE storage keys in the vault settings (secret encrypted). */
const crypto = require('crypto')
const fs = require('fs')
let SECRETS = {}
try { SECRETS = JSON.parse(fs.readFileSync('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}

const { PrismaClient } = require('@prisma/client')

function getSecret() {
  let env = process.env.CLOUD_AGENT_SECRET
  if (!env) {
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

const ACCESS = process.argv[2] || (SECRETS.joySecretKey || '')
const SECRET = process.argv[3] || (SECRETS.joyAccessKey || '')

async function up(key, value) {
  await db.userSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

async function main() {
  await up('r2store.accessKeyId', ACCESS)
  await up('r2store.secretEnc', encrypt(SECRET))
  await up('r2store.enabled', '1')
  await up('r2store.label', 'JOY SERVICE')
  console.log('JOY SERVICE keys stored: accessKeyId len=' + ACCESS.length + ', secret encrypted len=' + SECRET.length)
  console.log('waiting on: endpoint URL + bucket name (needed to verify + enable)')
}
main().finally(() => db.$disconnect())
