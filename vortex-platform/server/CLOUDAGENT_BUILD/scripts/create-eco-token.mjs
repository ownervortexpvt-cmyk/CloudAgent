#!/usr/bin/env node
/** Create an ecosystem Code Hub token (UserSetting key ecosystem_git_tokens). */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const KEY = 'ecosystem_git_tokens'

const plain = `vxtok_${crypto.randomBytes(24).toString('hex')}`
const row = {
  id: crypto.randomBytes(8).toString('hex'),
  name: 'owner-editor',
  hash: crypto.createHash('sha256').update(plain, 'utf8').digest('hex'),
  tail: plain.slice(-6),
  createdAt: Date.now(),
}

const cur = await db.userSetting.findUnique({ where: { key: KEY } })
let rows = []
try { rows = JSON.parse(cur?.value || '[]') } catch {}
rows.push(row)
await db.userSetting.upsert({ where: { key: KEY }, update: { value: JSON.stringify(rows) }, create: { key: KEY, value: JSON.stringify(rows) } })
console.log('TOKEN:')
console.log(plain)
console.log(`rows now: ${rows.length}`)
await db.$disconnect()
